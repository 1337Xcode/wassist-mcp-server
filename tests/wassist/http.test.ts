import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { WassistApiError } from '../../src/wassist/errors.js';
import { apiPath, WassistHttp } from '../../src/wassist/http.js';
import { FakeWassist, json, TEST_API_KEY } from '../helpers/fake-wassist.js';

// Accepts any JSON, so a test can focus on the request and the errors.
const pong = z.object({ ok: z.boolean() });

/** Runs a promise that is expected to fail and returns the error it failed with. */
async function failure(promise: Promise<unknown>): Promise<WassistApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WassistApiError) return error;
    throw error;
  }
  throw new Error('expected the request to fail');
}

describe('WassistHttp requests', () => {
  it('sends the key and JSON headers to the production API origin', async () => {
    const fake = new FakeWassist().on('POST', '/api/v1/agents/', { ok: true });
    await fake
      .createHttp()
      .request({ method: 'POST', path: '/agents/', body: { name: 'Bot' } }, pong);

    const [request] = fake.requests;
    expect(request?.url.href).toBe('https://backend.wassist.app/api/v1/agents/');
    expect(request?.headers.get('x-api-key')).toBe(TEST_API_KEY);
    expect(request?.headers.get('content-type')).toBe('application/json');
    expect(request?.headers.get('user-agent')).toBe('wassist-mcp-tests/0.0.0');
    expect(request?.body).toEqual({ name: 'Bot' });
  });

  it('percent-encodes interpolated path segments', () => {
    const id = '../admin?x=1';
    expect(apiPath`/agents/${id}/`).toBe('/agents/..%2Fadmin%3Fx%3D1/');
  });

  it('rejects keys that could break out of a header', () => {
    for (const apiKey of ['', 'has space', 'line\nbreak', 'x'.repeat(513)]) {
      expect(() => new WassistHttp({ apiKey, userAgent: 'test' })).toThrow(WassistApiError);
    }
  });

  it('does not follow redirects', async () => {
    const fake = new FakeWassist().on(
      'GET',
      '/api/v1/agents/',
      new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }),
    );
    const error = await failure(
      fake.createHttp().request({ method: 'GET', path: '/agents/' }, pong),
    );

    expect(error.kind).toBe('upstream_error');
    expect(error.details.status).toBe(302);
    expect(fake.requests).toHaveLength(1);
  });
});

describe('WassistHttp retries', () => {
  it('retries a GET after a 503 and returns the later success', async () => {
    let calls = 0;
    const fake = new FakeWassist().on('GET', '/api/v1/agents/', () =>
      ++calls === 1 ? json({}, 503) : json({ ok: true }),
    );
    const result = await fake.createHttp().request({ method: 'GET', path: '/agents/' }, pong);

    expect(result).toEqual({ ok: true });
    expect(fake.requests).toHaveLength(2);
  });

  it('waits for Retry-After on a 429 before retrying a GET', async () => {
    const delays: number[] = [];
    let calls = 0;
    const fake = new FakeWassist().on('GET', '/api/v1/agents/', () =>
      ++calls === 1
        ? json({ error: 'Rate limit exceeded' }, 429, { 'retry-after': '2' })
        : json({ ok: true }),
    );
    const http = fake.createHttp({ sleep: async (ms) => void delays.push(ms) });

    await http.request({ method: 'GET', path: '/agents/' }, pong);
    expect(delays).toEqual([2000]);
  });

  it('gives up immediately when Retry-After is longer than the wait cap', async () => {
    const fake = new FakeWassist().on('GET', '/api/v1/agents/', json({ retry_after: 60 }, 429));
    const error = await failure(
      fake.createHttp().request({ method: 'GET', path: '/agents/' }, pong),
    );

    expect(error.kind).toBe('rate_limited');
    expect(error.details.retryAfterSeconds).toBe(60);
    expect(fake.requests).toHaveLength(1);
  });

  it('stops retrying a GET after three attempts', async () => {
    const fake = new FakeWassist().on('GET', '/api/v1/agents/', json({}, 502));
    const error = await failure(
      fake.createHttp().request({ method: 'GET', path: '/agents/' }, pong),
    );

    expect(error.kind).toBe('upstream_error');
    expect(fake.requests).toHaveLength(3);
  });

  it('never retries a write and flags the outcome as unknown after a server error', async () => {
    const fake = new FakeWassist().on('POST', '/api/v1/agents/', json({}, 503));
    const error = await failure(
      fake.createHttp().request({ method: 'POST', path: '/agents/', body: {} }, pong),
    );

    expect(fake.requests).toHaveLength(1);
    expect(error.details.outcomeUnknown).toBe(true);
  });

  it('reports a timed out write as an unknown outcome instead of retrying', async () => {
    const fake = new FakeWassist().on(
      'POST',
      '/api/v1/agents/',
      () => new Promise<Response>(() => undefined),
    );
    const http = fake.createHttp({ timeoutMs: 20 });
    const error = await failure(http.request({ method: 'POST', path: '/agents/', body: {} }, pong));

    expect(error.kind).toBe('timeout');
    expect(error.details.outcomeUnknown).toBe(true);
    expect(fake.requests).toHaveLength(1);
  });

  it('reports cancellation when the caller aborts', async () => {
    const controller = new AbortController();
    const fake = new FakeWassist().on(
      'GET',
      '/api/v1/agents/',
      () => new Promise<Response>(() => undefined),
    );
    const pending = failure(
      fake.createHttp().request({ method: 'GET', path: '/agents/' }, pong, controller.signal),
    );
    controller.abort();

    expect((await pending).kind).toBe('cancelled');
  });
});

describe('WassistHttp error translation', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [400, 'invalid_request'],
  ] as const)('maps HTTP %i to %s', async (status, kind) => {
    const fake = new FakeWassist().on(
      'GET',
      '/api/v1/agents/',
      json({}, status, { 'x-request-id': 'req-123' }),
    );
    const error = await failure(
      fake.createHttp().request({ method: 'GET', path: '/agents/' }, pong),
    );

    expect(error.kind).toBe(kind);
    expect(error.details.status).toBe(status);
    expect(error.details.requestId).toBe('req-123');
  });

  it('turns a field validation body into one readable line', async () => {
    const fake = new FakeWassist().on(
      'POST',
      '/api/v1/agents/',
      json({ name: ['This field is required.'] }, 400),
    );
    const error = await failure(
      fake.createHttp().request({ method: 'POST', path: '/agents/', body: {} }, pong),
    );

    expect(error.message).toBe('name: This field is required.');
  });

  it('redacts the API key if the upstream message echoes it', async () => {
    const fake = new FakeWassist().on(
      'GET',
      '/api/v1/agents/',
      json({ detail: `Bad key ${TEST_API_KEY} supplied` }, 400),
    );
    const error = await failure(
      fake.createHttp().request({ method: 'GET', path: '/agents/' }, pong),
    );

    expect(error.message).toBe('Bad key [redacted] supplied');
  });

  it('does not pass through the body of a server error', async () => {
    const fake = new FakeWassist().on(
      'GET',
      '/api/v1/agents/',
      json({ detail: 'Traceback: secret internals' }, 500),
    );
    const error = await failure(
      fake.createHttp().request({ method: 'GET', path: '/agents/' }, pong),
    );

    expect(error.message).toBe('Wassist failed to process the request.');
  });

  it('names the failing field but not the value when the response has the wrong shape', async () => {
    const fake = new FakeWassist().on(
      'GET',
      '/api/v1/agents/',
      json({ ok: 'customer-private-value' }),
    );
    const error = await failure(
      fake.createHttp().request({ method: 'GET', path: '/agents/' }, pong),
    );

    expect(error.kind).toBe('invalid_response');
    expect(error.message).toBe('Wassist returned data in an unexpected shape at ok.');
  });

  it('refuses a response body over the size cap', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024 + 1);
    const fake = new FakeWassist().on(
      'GET',
      '/api/v1/agents/',
      () => new Response(big, { status: 200 }),
    );
    const error = await failure(
      fake.createHttp().request({ method: 'GET', path: '/agents/' }, pong),
    );

    expect(error.kind).toBe('invalid_response');
  });
});
