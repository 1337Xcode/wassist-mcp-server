import { afterEach, describe, expect, it } from 'vitest';
import { SCRIPT_SOURCE } from '../../src/oauth/pages.js';
import { FakeWassist, json } from '../helpers/fake-wassist.js';
import { startApp } from '../helpers/http-app.js';
import {
  authorizeUrl,
  bodyOf,
  CALLBACK,
  callbackParams,
  exchange,
  hiddenAuthorization,
  type OAuthApp,
  ORG_KEY,
  pkcePair,
  registerClient,
  signIn,
  startOAuthApp,
  submitKey,
  tokenRequest,
  validAuthorization,
  wassistAcceptingOrgKey,
} from '../helpers/oauth.js';

// The app under test, closed after each test.
let app: { close(): Promise<void> } | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Starts the app with the sign-in on and remembers it for cleanup. */
async function start(fake = wassistAcceptingOrgKey()): Promise<OAuthApp> {
  const started = await startOAuthApp(fake);
  app = started;
  return started;
}

/** POSTs a registration body to the registration endpoint. */
const register = (origin: string, body: unknown) =>
  fetch(`${origin}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('discovery', () => {
  it('describes the protected resource and the authorization server', async () => {
    const running = await start();
    const resource = await (
      await fetch(`${running.origin}/.well-known/oauth-protected-resource`)
    ).json();
    const suffixed = await (
      await fetch(`${running.origin}/.well-known/oauth-protected-resource/mcp`)
    ).json();
    const server = await (
      await fetch(`${running.origin}/.well-known/oauth-authorization-server`)
    ).json();

    expect(resource).toEqual({
      resource: `${running.publicUrl}/mcp`,
      authorization_servers: [running.publicUrl],
      bearer_methods_supported: ['header'],
    });
    expect(suffixed).toEqual(resource);
    expect(server).toMatchObject({
      issuer: running.publicUrl,
      authorization_endpoint: `${running.publicUrl}/oauth/authorize`,
      token_endpoint: `${running.publicUrl}/oauth/token`,
      registration_endpoint: `${running.publicUrl}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true,
    });
  });

  it('is off unless PUBLIC_URL is configured', async () => {
    const plain = await startApp(new FakeWassist());
    app = plain;

    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-authorization-server',
      '/oauth/token',
    ]) {
      expect((await fetch(`${plain.origin}${path}`)).status).toBe(404);
    }
  });

  it('points an unauthenticated MCP caller at the sign-in', async () => {
    const running = await start();
    const response = await fetch(`${running.origin}/mcp`, { method: 'POST' });

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer realm="wassist-mcp-server", resource_metadata="${running.publicUrl}/.well-known/oauth-protected-resource"`,
    );
  });
});

describe('client registration', () => {
  it('issues a client id for a loopback callback and an https callback', async () => {
    const running = await start();
    const response = await register(running.origin, {
      client_name: 'Claude',
      redirect_uris: [CALLBACK, 'https://claude.ai/api/mcp/auth_callback'],
    });
    const body = await bodyOf(response);

    expect(response.status).toBe(201);
    expect(body.client_id).toMatch(/^wsm1\./);
    expect(body).toMatchObject({
      client_name: 'Claude',
      redirect_uris: [CALLBACK, 'https://claude.ai/api/mcp/auth_callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    });
  });

  it.each([
    ['plain http to another host', ['http://evil.example/cb']],
    ['a javascript URL', ['javascript:alert(1)']],
    ['a fragment', ['https://app.example/cb#x']],
    ['embedded credentials', ['https://user:pass@app.example/cb']],
    ['not a URL', ['not a url']],
  ])('refuses %s as a redirect URI', async (_label, redirectUris) => {
    const running = await start();
    const response = await register(running.origin, { redirect_uris: redirectUris });

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).error).toMatch(/^invalid_(redirect_uri|client_metadata)$/);
  });

  it('refuses a registration without redirect URIs', async () => {
    const running = await start();
    const response = await register(running.origin, { client_name: 'No callback' });

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).error).toBe('invalid_client_metadata');
  });
});

describe('redirect host allow-list', () => {
  const claude = 'https://claude.ai/api/mcp/auth_callback';

  it('registers only allowed https hosts, and always allows localhost', async () => {
    const running = await startOAuthApp(wassistAcceptingOrgKey(), {}, ['claude.ai']);
    app = running;

    expect((await register(running.origin, { redirect_uris: [claude] })).status).toBe(201);
    expect((await register(running.origin, { redirect_uris: [CALLBACK] })).status).toBe(201);
    const refused = await register(running.origin, { redirect_uris: ['https://evil.example/cb'] });
    expect(refused.status).toBe(400);
    expect((await bodyOf(refused)).error).toBe('invalid_redirect_uri');
  });

  it('refuses a client registered earlier for a host that is no longer allowed', async () => {
    const open = await startOAuthApp(wassistAcceptingOrgKey());
    const clientId = await registerClient(open.origin, ['https://evil.example/cb']);
    await open.close();

    const strict = await startOAuthApp(wassistAcceptingOrgKey(), {}, ['claude.ai']);
    app = strict;
    const { challenge } = pkcePair();
    const params = {
      ...validAuthorization(clientId, challenge, strict.publicUrl),
      redirect_uri: 'https://evil.example/cb',
    };
    const response = await fetch(authorizeUrl(strict.origin, params), { redirect: 'manual' });

    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
  });
});

describe('authorization request', () => {
  it('never redirects for an unknown client or an unregistered callback', async () => {
    const running = await start();
    const { challenge } = pkcePair();
    const clientId = await registerClient(running.origin);
    const good = validAuthorization(clientId, challenge, running.publicUrl);

    const unknown = await fetch(
      authorizeUrl(running.origin, { ...good, client_id: 'wsm1.a.b.c' }),
      { redirect: 'manual' },
    );
    const stranger = await fetch(
      authorizeUrl(running.origin, { ...good, redirect_uri: 'https://evil.example/cb' }),
      { redirect: 'manual' },
    );

    for (const response of [unknown, stranger]) {
      expect(response.status).toBe(400);
      expect(response.headers.get('location')).toBeNull();
      expect(await response.text()).toContain('Cannot connect');
    }
  });

  it.each([
    ['a missing challenge', { code_challenge: '' }, 'invalid_request'],
    ['the plain challenge method', { code_challenge_method: 'plain' }, 'invalid_request'],
    ['the implicit flow', { response_type: 'token' }, 'unsupported_response_type'],
    [
      'a resource that is another server',
      { resource: 'https://other.example/mcp' },
      'invalid_target',
    ],
  ])('sends %s back to the client as an error', async (_label, override, error) => {
    const running = await start();
    const { challenge } = pkcePair();
    const clientId = await registerClient(running.origin);
    const params = { ...validAuthorization(clientId, challenge, running.publicUrl), ...override };
    const response = await fetch(authorizeUrl(running.origin, params), { redirect: 'manual' });
    const back = callbackParams(response);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toMatch(/^http:\/\/127\.0\.0\.1:9\/callback\?/);
    expect(back.get('error')).toBe(error);
    expect(back.get('state')).toBe('state-1');
    expect(back.get('iss')).toBe(running.publicUrl);
  });

  it('shows who is asking, runs only its own script and cannot be framed or cached', async () => {
    const running = await start();
    const { challenge } = pkcePair();
    const clientId = await registerClient(running.origin, [CALLBACK], '<script>alert(1)</script>');
    const response = await fetch(
      authorizeUrl(running.origin, validAuthorization(clientId, challenge, running.publicUrl)),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('type="password"');
    expect(response.headers.get('content-security-policy')).toContain(
      `script-src ${SCRIPT_SOURCE};`,
    );
    expect(response.headers.get('content-security-policy')).toContain("font-src 'self';");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('content-security-policy')).toContain(
      "form-action 'self' http://127.0.0.1:9;",
    );
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
    expect(html).toContain('aria-label="Wassist"');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('the page font', () => {
  it('is served from this server with a long cache', async () => {
    const running = await start();
    const response = await fetch(`${running.origin}/oauth/geist.woff2`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('font/woff2');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
  });
});

describe('consent submission', () => {
  async function consent(running: OAuthApp) {
    const { challenge } = pkcePair();
    const clientId = await registerClient(running.origin);
    const page = await fetch(
      authorizeUrl(running.origin, validAuthorization(clientId, challenge, running.publicUrl)),
    );
    return hiddenAuthorization(await page.text());
  }

  it('checks the key with Wassist and hands the client a code, not the key', async () => {
    const fake = wassistAcceptingOrgKey();
    const running = await start(fake);
    const response = await submitKey(running.origin, await consent(running), ORG_KEY);
    const back = callbackParams(response);

    expect(response.status).toBe(303);
    expect(back.get('code')).toMatch(/^wsm1\./);
    expect(back.get('state')).toBe('state-1');
    expect(back.get('iss')).toBe(running.publicUrl);
    expect(response.headers.get('location')).not.toContain(ORG_KEY);
    expect(fake.requests.map((request) => request.headers.get('x-api-key'))).toEqual([ORG_KEY]);
  });

  it('stays on the page when Wassist rejects the key', async () => {
    const running = await start();
    const response = await submitKey(
      running.origin,
      await consent(running),
      'not-the-right-key-123',
    );
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(html).toContain('Wassist did not accept that key');
    expect(html).not.toContain('not-the-right-key-123');
  });

  it('asks the user to retry when Wassist cannot be reached', async () => {
    const running = await start(new FakeWassist().on('GET', '/api/v1/agents/', json({}, 503)));
    const response = await submitKey(running.origin, await consent(running), ORG_KEY);

    expect(response.status).toBe(502);
    expect(await response.text()).toContain('Could not reach Wassist');
  });

  it('accepts the form from its own origin and refuses Origin: null, which no-referrer pages send', async () => {
    const running = await start();
    const own = await submitKey(running.origin, await consent(running), ORG_KEY, {
      origin: running.origin,
    });
    const hidden = await submitKey(running.origin, await consent(running), ORG_KEY, {
      origin: 'null',
    });

    expect(own.status).toBe(303);
    expect(hidden.status).toBe(403);
    expect((await bodyOf(hidden)).error.message).toContain('Invalid Origin header');
  });

  it('rejects a key with spaces before it reaches Wassist', async () => {
    const fake = wassistAcceptingOrgKey();
    const running = await start(fake);
    const response = await submitKey(running.origin, await consent(running), 'has a space');

    expect(response.status).toBe(400);
    expect(fake.requests).toHaveLength(0);
  });

  it('refuses a tampered or unknown authorization field', async () => {
    const running = await start();
    const response = await submitKey(running.origin, 'wsm1.AAAA.BBBB.CCCC', ORG_KEY);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Link expired');
  });
});

describe('token endpoint', () => {
  it('exchanges a code for tokens that do not contain the key', async () => {
    const running = await start();
    const tokens = await exchange(running, await signIn(running));

    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.expires_in).toBe(3600);
    for (const token of [tokens.access_token, tokens.refresh_token]) {
      expect(token).toMatch(/^wsm1\./);
      expect(token).not.toContain(ORG_KEY);
      expect(Buffer.from(token.split('.')[2] ?? '', 'base64url').toString('latin1')).not.toContain(
        ORG_KEY,
      );
    }
  });

  it('serves MCP calls with the access token and forwards the key inside it', async () => {
    const fake = wassistAcceptingOrgKey();
    const running = await start(fake);
    const tokens = await exchange(running, await signIn(running));
    fake.requests.length = 0;

    const response = await fetch(`${running.origin}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });

    expect(response.status).toBe(200);
  });

  it.each([
    ['the wrong verifier', { code_verifier: pkcePair().verifier }],
    ['the wrong redirect URI', { redirect_uri: 'http://127.0.0.1:9/other' }],
    ['another client id', { client_id: 'wsm1.other.client.id' }],
  ])('rejects a code redeemed with %s', async (_label, override) => {
    const running = await start();
    const session = await signIn(running);
    const response = await tokenRequest(running.origin, {
      grant_type: 'authorization_code',
      code: session.code,
      client_id: session.clientId,
      redirect_uri: CALLBACK,
      code_verifier: session.verifier,
      ...override,
    });

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).error).toBe('invalid_grant');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('accepts a code once and refuses a replay', async () => {
    const running = await start();
    const session = await signIn(running);
    const form = {
      grant_type: 'authorization_code',
      code: session.code,
      client_id: session.clientId,
      redirect_uri: CALLBACK,
      code_verifier: session.verifier,
    };

    expect((await tokenRequest(running.origin, form)).status).toBe(200);
    const replay = await tokenRequest(running.origin, form);
    expect(replay.status).toBe(400);
    expect((await bodyOf(replay)).error_description).toContain('already used');
  });

  it('refreshes tokens for the same client only', async () => {
    const running = await start();
    const session = await signIn(running);
    const tokens = await exchange(running, session);

    const refreshed = await tokenRequest(running.origin, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: session.clientId,
    });
    const other = await tokenRequest(running.origin, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: await registerClient(running.origin),
    });

    expect(refreshed.status).toBe(200);
    expect((await bodyOf(refreshed)).access_token).toMatch(/^wsm1\./);
    expect(other.status).toBe(400);
  });

  it('retires a refresh token once it has been used', async () => {
    const running = await start();
    const session = await signIn(running);
    const tokens = await exchange(running, session);
    const form = {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: session.clientId,
    };

    expect((await tokenRequest(running.origin, form)).status).toBe(200);
    const replay = await tokenRequest(running.origin, form);
    expect(replay.status).toBe(400);
    expect((await bodyOf(replay)).error_description).toContain('already used');
  });

  it('ends the whole sign-in when a retired refresh token comes back', async () => {
    const running = await start();
    const session = await signIn(running);
    const first = await exchange(running, session);
    const refresh = (token: string) =>
      tokenRequest(running.origin, {
        grant_type: 'refresh_token',
        refresh_token: token,
        client_id: session.clientId,
      });

    const second = await bodyOf(await refresh(first.refresh_token));
    expect((await refresh(first.refresh_token)).status).toBe(400);
    // The newest token belonged to the same sign-in, so a copied token cannot outlive it.
    expect((await refresh(second.refresh_token)).status).toBe(400);
  });

  it('will not let a token be used for a step it was not made for', async () => {
    const running = await start();
    const session = await signIn(running);
    const tokens = await exchange(running, session);

    const accessAsRefresh = await tokenRequest(running.origin, {
      grant_type: 'refresh_token',
      refresh_token: tokens.access_token,
      client_id: session.clientId,
    });
    const refreshAsAccess = await fetch(`${running.origin}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens.refresh_token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });

    expect(accessAsRefresh.status).toBe(400);
    expect(refreshAsAccess.status).toBe(401);
    expect(refreshAsAccess.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('rejects unsupported grants and the wrong content type', async () => {
    const running = await start();
    const unsupported = await tokenRequest(running.origin, { grant_type: 'client_credentials' });
    const wrongType = await fetch(`${running.origin}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"grant_type":"refresh_token"}',
    });

    expect((await bodyOf(unsupported)).error).toBe('unsupported_grant_type');
    expect(wrongType.status).toBe(400);
    expect((await bodyOf(wrongType)).error).toBe('invalid_request');
  });

  it('rejects a tampered access token and still accepts a raw Wassist key', async () => {
    const running = await start();
    const tokens = await exchange(running, await signIn(running));
    const call = (credential: string) =>
      fetch(`${running.origin}/mcp`, {
        method: 'POST',
        headers: {
          'x-api-key': credential,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      });

    expect((await call(`${tokens.access_token}x`)).status).toBe(401);
    expect((await call(ORG_KEY)).status).toBe(200);
  });
});
