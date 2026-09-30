import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import type { HttpConfig } from '../../src/config.js';
import { FakeWassist, json } from './fake-wassist.js';
import { type RunningApp, startApp } from './http-app.js';
import type { ToolData } from './mcp.js';

// The one key the fake Wassist accepts, a secret for sealing, and the callback the test client registers.
export const ORG_KEY = 'wassist-org-key-0123456789abcdef';
const OAUTH_SECRET = 'oauth-test-secret-0123456789abcdef0123456789';
export const CALLBACK = 'http://127.0.0.1:9/callback';

/** A fake Wassist that accepts one key and answers 401 to every other. */
export function wassistAcceptingOrgKey(): FakeWassist {
  return new FakeWassist().on('GET', '/api/v1/agents/', (request) =>
    request.headers.get('x-api-key') === ORG_KEY
      ? json({ count: 0, next: null, results: [] })
      : json({ detail: 'Invalid API key.' }, 401),
  );
}

/** Finds a port nobody is using, by binding to port 0 and letting go. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** Where the OAuth endpoints are reached, and the URL the server believes it has. */
export interface Endpoint {
  origin: string;
  publicUrl: string;
}

/** A running app that has the sign-in on. */
export interface OAuthApp extends RunningApp, Endpoint {}

/** Starts the HTTP app with the OAuth sign-in on. The public URL must match the port it listens on. */
export async function startOAuthApp(
  fake: FakeWassist,
  overrides: Partial<HttpConfig> = {},
  redirectHosts: string[] = [],
): Promise<OAuthApp> {
  const port = await freePort();
  const publicUrl = `http://127.0.0.1:${port}`;
  const running = await startApp(
    fake,
    {
      oauth: { publicUrl, secret: OAUTH_SECRET, secretIsEphemeral: false, redirectHosts },
      ...overrides,
    },
    port,
  );
  return { ...running, publicUrl };
}

/** Reads a JSON response body. Each test asserts the exact fields it cares about. */
export async function bodyOf(response: Response): Promise<ToolData> {
  return response.json();
}

/** A PKCE verifier and its S256 challenge. */
export function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** Registers a client and returns its client id. */
export async function registerClient(
  origin: string,
  redirectUris: string[] = [CALLBACK],
  name = 'Test assistant',
): Promise<string> {
  const response = await fetch(`${origin}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: name, redirect_uris: redirectUris }),
  });
  const body = (await response.json()) as { client_id: string };
  return body.client_id;
}

/** Builds an /oauth/authorize URL from query parameters. */
export function authorizeUrl(origin: string, params: Record<string, string>): string {
  return `${origin}/oauth/authorize?${new URLSearchParams(params)}`;
}

/** The parameters a well-behaved client sends, ready to override one at a time. */
export function validAuthorization(clientId: string, challenge: string, publicUrl: string) {
  return {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CALLBACK,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'state-1',
    resource: `${publicUrl}/mcp`,
  };
}

/** Reads the sealed authorization request out of the sign-in page's hidden field. */
export function hiddenAuthorization(html: string): string {
  const match = /name="authorization" value="([^"]+)"/.exec(html);
  if (!match?.[1]) throw new Error('The consent page has no authorization field.');
  return match[1];
}

/** Posts the sign-in form like a browser would, without following the redirect. */
export function submitKey(
  origin: string,
  authorization: string,
  apiKey: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${origin}/oauth/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ authorization, api_key: apiKey }),
  });
}

/** The query parameters of the redirect back to the client. */
export function callbackParams(response: Response): URLSearchParams {
  const location = response.headers.get('location');
  if (!location) throw new Error(`Expected a redirect, got HTTP ${response.status}.`);
  return new URL(location).searchParams;
}

/** Posts a form to the token endpoint. */
export function tokenRequest(origin: string, form: Record<string, string>): Promise<Response> {
  return fetch(`${origin}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
}

/** Runs registration and sign-in like a browser would, and returns a code ready to exchange. */
export async function signIn(app: Endpoint, apiKey = ORG_KEY) {
  const clientId = await registerClient(app.origin);
  const { verifier, challenge } = pkcePair();
  const page = await fetch(
    authorizeUrl(app.origin, validAuthorization(clientId, challenge, app.publicUrl)),
  );
  const response = await submitKey(app.origin, hiddenAuthorization(await page.text()), apiKey);
  const code = callbackParams(response).get('code') ?? '';
  return { clientId, verifier, code };
}

/** Exchanges a signed-in session's code for tokens. */
export async function exchange(app: Endpoint, session: Awaited<ReturnType<typeof signIn>>) {
  const response = await tokenRequest(app.origin, {
    grant_type: 'authorization_code',
    code: session.code,
    client_id: session.clientId,
    redirect_uri: CALLBACK,
    code_verifier: session.verifier,
  });
  return (await response.json()) as {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
  };
}
