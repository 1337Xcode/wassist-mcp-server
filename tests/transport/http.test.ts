import { request } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { allTools, TOOLSET_NAMES } from '../../src/tools.js';
import { FakeWassist, json } from '../helpers/fake-wassist.js';
import { upstreamAgent } from '../helpers/fixtures.js';
import { type RunningApp, startApp } from '../helpers/http-app.js';

// Keys of two organizations, to prove that they never mix.
const KEY_A = 'key-for-organization-a-0001';
const KEY_B = 'key-for-organization-b-0002';

// The app under test, closed after each test.
let running: RunningApp | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

// A ping needs no tools, so it exercises the guards alone.
const initialize = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });

/** POSTs to the app with the given headers and body. */
function post(
  app: RunningApp,
  headers: Record<string, string>,
  body: string = initialize,
  path = '/mcp',
) {
  return fetch(new URL(path, app.origin), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body,
  });
}

/** Sends a request with a chosen Host header through node:http. */
function withHostHeader(app: RunningApp, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const headers = {
      host,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-api-key': KEY_A,
    };
    const req = request(app.mcpUrl, { method: 'POST', headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end(initialize);
  });
}

describe('HTTP transport guards', () => {
  it('answers the health check without credentials', async () => {
    running = await startApp(new FakeWassist());
    const response = await fetch(new URL('/healthz', running.origin));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });

  it('rejects a request with no API key and asks for one', async () => {
    running = await startApp(new FakeWassist());
    const response = await post(running, {});

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer realm="wassist-mcp-server"');
  });

  it('does not accept an API key from the URL', async () => {
    running = await startApp(new FakeWassist());
    const response = await post(
      running,
      {},
      initialize,
      `/mcp?apiKey=${KEY_A}&api_key=${KEY_A}&token=${KEY_A}`,
    );

    expect(response.status).toBe(401);
  });

  it('rejects malformed or duplicated key headers', async () => {
    running = await startApp(new FakeWassist());

    expect((await post(running, { 'x-api-key': 'has space' })).status).toBe(401);
    expect((await post(running, { authorization: 'Basic abc' })).status).toBe(401);
    expect((await post(running, { 'x-api-key': `${KEY_A}, ${KEY_B}` })).status).toBe(401);
  });

  it('rejects an unexpected Host header to block DNS rebinding', async () => {
    running = await startApp(new FakeWassist());

    expect(await withHostHeader(running, 'evil.example')).toBe(403);
  });

  it('accepts the Host header of a configured tunnel domain', async () => {
    running = await startApp(new FakeWassist(), { allowedHosts: ['demo.ngrok-free.app'] });

    expect(await withHostHeader(running, 'demo.ngrok-free.app')).toBe(200);
  });

  it('rejects a browser Origin from another site and accepts one from an allowed host', async () => {
    running = await startApp(new FakeWassist(), { allowedHosts: ['app.example.com'] });

    expect(
      (await post(running, { 'x-api-key': KEY_A, origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect(
      (await post(running, { 'x-api-key': KEY_A, origin: 'https://app.example.com' })).status,
    ).toBe(200);
  });

  it('rejects an oversized body, a wrong content type and invalid JSON', async () => {
    running = await startApp(new FakeWassist(), { maxBodyBytes: 1024 });

    expect((await post(running, { 'x-api-key': KEY_A }, 'x'.repeat(2048))).status).toBe(413);
    expect((await post(running, { 'x-api-key': KEY_A, 'content-type': 'text/plain' })).status).toBe(
      415,
    );
    expect((await post(running, { 'x-api-key': KEY_A }, '{not json')).status).toBe(400);
  });

  it('rate limits per API key and keeps other keys unaffected', async () => {
    running = await startApp(new FakeWassist(), { rateLimitPerMinute: 2 });

    expect((await post(running, { 'x-api-key': KEY_A })).status).toBe(200);
    expect((await post(running, { 'x-api-key': KEY_A })).status).toBe(200);
    const limited = await post(running, { 'x-api-key': KEY_A });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await post(running, { 'x-api-key': KEY_B })).status).toBe(200);
  });

  it('returns 404 for any other path', async () => {
    running = await startApp(new FakeWassist());

    expect((await post(running, { 'x-api-key': KEY_A }, initialize, '/admin')).status).toBe(404);
  });
});

describe.each(['modern', 'legacy'] as const)('MCP over HTTP (%s protocol era)', (era) => {
  function connect(app: RunningApp, headers: Record<string, string>) {
    const client = new Client(
      { name: 'tests', version: '0.0.0' },
      era === 'modern' ? { versionNegotiation: { mode: 'auto' } } : {},
    );
    return client
      .connect(new StreamableHTTPClientTransport(app.mcpUrl, { requestInit: { headers } }))
      .then(() => client);
  }

  it("serves tools and forwards each caller's own key to Wassist", async () => {
    const fake = new FakeWassist().on('GET', '/api/v1/agents/', {
      count: 1,
      next: null,
      results: [upstreamAgent()],
    });
    running = await startApp(fake);
    const client = await connect(running, { 'x-api-key': KEY_A });

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(allTools.length);
    const result = await client.callTool({ name: 'wassist_list_agents', arguments: {} });
    await client.close();

    expect(result.isError).not.toBe(true);
    expect(fake.requests.map((entry) => entry.headers.get('x-api-key'))).toEqual([KEY_A]);
  });

  it('accepts the key as an Authorization bearer token', async () => {
    const fake = new FakeWassist().on('GET', '/api/v1/agents/', {
      count: 0,
      next: null,
      results: [],
    });
    running = await startApp(fake);
    const client = await connect(running, { authorization: `Bearer ${KEY_B}` });
    await client.callTool({ name: 'wassist_list_agents', arguments: {} });
    await client.close();

    expect(fake.requests[0]?.headers.get('x-api-key')).toBe(KEY_B);
  });

  it('keeps two organizations apart when they call at the same time', async () => {
    const seen: { key: string | null; agent: string }[] = [];
    const fake = new FakeWassist().on('GET', '/api/v1/agents/', (req) => {
      const key = req.headers.get('x-api-key');
      seen.push({ key, agent: key === KEY_A ? 'Agent of A' : 'Agent of B' });
      return json({
        count: 1,
        next: null,
        results: [upstreamAgent({ name: key === KEY_A ? 'Agent of A' : 'Agent of B' })],
      });
    });
    running = await startApp(fake);
    const [clientA, clientB] = await Promise.all([
      connect(running, { 'x-api-key': KEY_A }),
      connect(running, { 'x-api-key': KEY_B }),
    ]);

    const [a, b] = await Promise.all([
      clientA.callTool({ name: 'wassist_list_agents', arguments: {} }),
      clientB.callTool({ name: 'wassist_list_agents', arguments: {} }),
    ]);
    await Promise.all([clientA.close(), clientB.close()]);

    const names = (result: typeof a) =>
      (result.structuredContent as { items: { name: string }[] }).items.map((item) => item.name);
    expect(names(a)).toEqual(['Agent of A']);
    expect(names(b)).toEqual(['Agent of B']);
    expect(seen.map((entry) => entry.key).sort()).toEqual([KEY_A, KEY_B]);
  });

  it('hides the write tools when the deployment is read-only', async () => {
    running = await startApp(new FakeWassist(), {
      tools: { readOnly: true, toolsets: TOOLSET_NAMES },
    });
    const client = await connect(running, { 'x-api-key': KEY_A });
    const { tools } = await client.listTools();
    await client.close();

    expect(tools).toHaveLength(allTools.filter((tool) => tool.effect === 'read').length);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  });
});
