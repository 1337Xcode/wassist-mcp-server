import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createOAuth } from '../../src/oauth/handler.js';
import {
  bodyOf,
  CALLBACK,
  type Endpoint,
  exchange,
  ORG_KEY,
  signIn,
  tokenRequest,
} from '../helpers/oauth.js';

// The address the server believes it has. The tests reach it on a local port instead.
const PUBLIC_URL = 'https://mcp.example.com';
const SECRET = 'expiry-test-secret-0123456789abcdef012345';

// The bare servers under test, closed after each test.
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

/**
 * The OAuth handler on a bare server, with a clock the test controls. Every call shares the same
 * secret and public URL, so a second call stands in for the same server after a restart.
 */
async function start() {
  let now = Date.parse('2026-01-01T00:00:00Z');
  const oauth = createOAuth({
    publicUrl: PUBLIC_URL,
    secret: SECRET,
    verifyKey: async () => 'valid',
    now: () => now,
  });
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', PUBLIC_URL).pathname;
    oauth.handle(req, res, path).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint: Endpoint = {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    publicUrl: PUBLIC_URL,
  };
  const advance = (seconds: number) => {
    now += seconds * 1000;
  };
  return { oauth, endpoint, advance };
}

describe('token lifetimes', () => {
  it('lets an authorization code expire after a minute', async () => {
    const { endpoint, advance } = await start();
    const session = await signIn(endpoint);
    advance(61);
    const response = await tokenRequest(endpoint.origin, {
      grant_type: 'authorization_code',
      code: session.code,
      client_id: session.clientId,
      redirect_uri: CALLBACK,
      code_verifier: session.verifier,
    });

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).error).toBe('invalid_grant');
  });

  it('expires the access token after an hour while the refresh token keeps working', async () => {
    const { oauth, endpoint, advance } = await start();
    const session = await signIn(endpoint);
    const tokens = await exchange(endpoint, session);

    expect(oauth.resolveToken(tokens.access_token)).toBe(ORG_KEY);
    advance(3601);
    expect(oauth.resolveToken(tokens.access_token)).toBeUndefined();

    const refreshed = await tokenRequest(endpoint.origin, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: session.clientId,
    });
    const fresh = await bodyOf(refreshed);
    expect(refreshed.status).toBe(200);
    expect(oauth.resolveToken(fresh.access_token)).toBe(ORG_KEY);
  });

  it('expires the refresh token after thirty days', async () => {
    const { endpoint, advance } = await start();
    const session = await signIn(endpoint);
    const tokens = await exchange(endpoint, session);
    advance(31 * 24 * 3600);
    const response = await tokenRequest(endpoint.origin, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: session.clientId,
    });

    expect(response.status).toBe(400);
  });

  it('passes a credential that is not a sealed token straight through', async () => {
    const { oauth } = await start();

    expect(oauth.resolveToken('a-raw-wassist-key-12345')).toBe('a-raw-wassist-key-12345');
  });
});

describe('refresh token rotation across a restart', () => {
  it('accepts a refresh token issued before a restart once, then rotates it as usual', async () => {
    const before = await start();
    const session = await signIn(before.endpoint);
    const tokens = await exchange(before.endpoint, session);
    const restarted = await start();
    const form = {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: session.clientId,
    };

    expect((await tokenRequest(restarted.endpoint.origin, form)).status).toBe(200);
    expect((await tokenRequest(restarted.endpoint.origin, form)).status).toBe(400);
  });
});
