import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { BodyError, readFormBody, readJsonBody } from '../http/body.js';
import { RateLimiter } from '../http/rate-limit.js';
import { sendHtml, sendJson } from '../http/respond.js';
import { isValidApiKey } from '../wassist/http.js';
import type { KeyVerdict } from '../wassist/verify.js';
import { consentPage, FONT_PATH, messagePage, SCRIPT_SOURCE } from './pages.js';
import { isSealed, Sealer } from './seal.js';

// Lifetimes in seconds. A code is short because it crosses a browser redirect. A refresh token is long so a sign-in lasts.
const CLIENT_TTL = 90 * 24 * 3600;
const AUTHORIZATION_TTL = 10 * 60;
const CODE_TTL = 60;
const ACCESS_TTL = 3600;
const REFRESH_TTL = 30 * 24 * 3600;
/** Sign-in and registration bodies are tiny, so anything larger is refused. */
const FORM_LIMIT_BYTES = 16 * 1024;
/** How often each sign-in endpoint may be called per minute. */
const REQUESTS_PER_MINUTE = 60;
/** Hostnames that mean this machine, where plain http callbacks are allowed. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Sealed into the client id, so the server needs no table of clients.
const clientSchema = z.object({ name: z.string(), redirectUris: z.array(z.string()) });
// The sign-in request, sealed into the form so the page keeps no state between its two steps.
const authorizationSchema = z.object({
  clientId: z.string(),
  clientName: z.string(),
  redirectUri: z.string(),
  challenge: z.string(),
  state: z.string().optional(),
});
// The authorization code: the Wassist key, and what the token request must match.
const codeSchema = z.object({
  apiKey: z.string(),
  clientHash: z.string(),
  redirectUri: z.string(),
  challenge: z.string(),
  id: z.string(),
});
// The access token holds only the Wassist key.
const accessSchema = z.object({ apiKey: z.string() });
// The refresh token also names the client it was issued to, the sign-in it descends from, and
// how many times that sign-in has been refreshed.
const refreshSchema = z.object({
  apiKey: z.string(),
  clientHash: z.string(),
  family: z.string(),
  generation: z.number().int().min(0),
});
// The part of a client registration request that this server reads.
const registrationSchema = z.object({
  redirect_uris: z.array(z.string().max(2048)).min(1).max(10),
  client_name: z.string().max(200).optional(),
});

/** What the sign-in needs to run. */
export interface OAuthOptions {
  /** Where clients reach this server, for example https://mcp.example.com. No path. */
  publicUrl: string;
  /** Key material for sealing tokens. Changing it signs everyone out. */
  secret: string;
  verifyKey(apiKey: string): Promise<KeyVerdict>;
  /** Hostnames that may receive sign-in codes over https. Empty or missing means any host. */
  redirectHosts?: string[];
  now?: () => number;
}

/** The sign-in as the HTTP server uses it. */
export interface OAuth {
  resourceMetadataUrl: string;
  /** Serves the discovery documents and the /oauth endpoints. False means the path is not OAuth's. */
  handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean>;
  /** Opens an access token into the Wassist key inside it. Any other credential passes through. */
  resolveToken(token: string): string | undefined;
}

/** SHA-256 of a string, as raw bytes. */
const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();
/** A short fingerprint of a client id, so tokens can name their client without carrying the whole id. */
const clientHash = (clientId: string): string =>
  sha256(clientId).toString('base64url').slice(0, 22);

/** Checks a PKCE verifier against the challenge from the sign-in, in constant time. */
function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = sha256(verifier);
  const expected = Buffer.from(challenge, 'base64url');
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

/**
 * Accepts https callbacks, and http callbacks on localhost, with no credentials or fragment. When
 * `redirectHosts` is not empty, https callbacks must be on one of those hosts. Localhost stays allowed
 * because a code sent there only reaches the user's own machine.
 */
function isAllowedRedirect(value: string, redirectHosts: string[]): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname);
  return (
    url.protocol === 'https:' &&
    (redirectHosts.length === 0 || redirectHosts.includes(url.hostname))
  );
}

/** The Geist font the sign-in page uses. It ships in the repository under its open font license. */
const FONT_FILE = new URL('../../assets/fonts/Geist-Variable.woff2', import.meta.url);

/**
 * Serves the page font from this server, so the page needs no other host. It is read once. When
 * the file is missing, as in a bundle without assets, the page falls back to the system font.
 */
function serveFont(res: ServerResponse, cache: { font?: Buffer | null }): true {
  if (cache.font === undefined) {
    try {
      cache.font = readFileSync(FONT_FILE);
    } catch {
      cache.font = null;
    }
  }
  if (cache.font === null) {
    sendJson(res, 404, { error: 'not_found' });
    return true;
  }
  res.writeHead(200, {
    'content-type': 'font/woff2',
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  });
  res.end(cache.font);
  return true;
}

/** Answers a token or registration request with an RFC 6749 error body. */
function oauthError(res: ServerResponse, status: number, error: string, description: string): void {
  sendJson(res, status, { error, error_description: description }, { pragma: 'no-cache' });
}

/** Answers 405 with the methods the path accepts. Returns true so callers can return it. */
function methodNotAllowed(res: ServerResponse, allow: string): true {
  sendJson(res, 405, { error: 'method_not_allowed' }, { allow });
  return true;
}

/** Marks a refresh token family whose old token was presented again, so the whole family is dead. */
const REVOKED = -1;

/**
 * An OAuth 2.1 authorization server for clients that cannot send a static key, such as ChatGPT and
 * Claude.ai. Wassist has no OAuth of its own, so the sign-in page asks for an API key, checks it
 * with Wassist and seals it into the tokens. Nothing is stored except a short list of used codes
 * and the latest generation of each refresh token family.
 */
export function createOAuth({
  publicUrl,
  secret,
  verifyKey,
  redirectHosts = [],
  now = Date.now,
}: OAuthOptions): OAuth {
  const sealer = new Sealer(secret, now);
  const limiter = new RateLimiter(REQUESTS_PER_MINUTE, 60_000, now);
  const usedCodes = new Map<string, number>();
  const assets: { font?: Buffer | null } = {};
  // Refresh tokens rotate: each sign-in starts a family, and each refresh moves it to the next
  // generation. An older generation coming back means the token was copied, so the family is
  // revoked, as OAuth 2.1 asks for public clients. Memory only, so a restart forgets the families.
  const families = new Map<string, { generation: number; expires: number }>();
  const resourceUrl = `${publicUrl}/mcp`;
  const resourceMetadataUrl = `${publicUrl}/.well-known/oauth-protected-resource`;

  const protectedResource = {
    resource: resourceUrl,
    authorization_servers: [publicUrl],
    bearer_methods_supported: ['header'],
  };
  const authorizationServer = {
    issuer: publicUrl,
    authorization_endpoint: `${publicUrl}/oauth/authorize`,
    token_endpoint: `${publicUrl}/oauth/token`,
    registration_endpoint: `${publicUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true,
  };

  /** Sends the browser back to the client's callback with `params`, and the issuer as RFC 9207 asks. */
  function redirectTo(
    res: ServerResponse,
    redirectUri: string,
    params: Record<string, string | undefined>,
  ) {
    const target = new URL(redirectUri);
    for (const [key, value] of Object.entries({ ...params, iss: publicUrl })) {
      if (value !== undefined) target.searchParams.set(key, value);
    }
    res.writeHead(303, { location: target.href, 'cache-control': 'no-store' });
    res.end();
  }

  /**
   * Builds the token response: a one-hour access token and a 30-day refresh token, and records
   * the refresh token's generation as the only one its family now accepts.
   */
  function issueTokens(apiKey: string, client: string, family: string, generation: number) {
    const expires = now() + REFRESH_TTL * 1000;
    for (const [id, entry] of families) if (entry.expires <= now()) families.delete(id);
    families.set(family, { generation, expires });
    return {
      access_token: sealer.seal('access', { apiKey }, ACCESS_TTL),
      token_type: 'Bearer',
      expires_in: ACCESS_TTL,
      refresh_token: sealer.seal(
        'refresh',
        { apiKey, clientHash: client, family, generation },
        REFRESH_TTL,
      ),
    };
  }

  /** Serves one of the discovery documents. */
  function metadata(req: IncomingMessage, res: ServerResponse, document: object): true {
    if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, 'GET, HEAD');
    sendJson(res, 200, document, { 'cache-control': 'public, max-age=300' });
    return true;
  }

  /** POST /oauth/register. Registers a client by sealing its name and callbacks into its client id. */
  async function register(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return void methodNotAllowed(res, 'POST');
    if (!limiter.check('register').allowed)
      return oauthError(res, 429, 'slow_down', 'Too many requests.');
    let body: unknown;
    try {
      body = await readJsonBody(req, FORM_LIMIT_BYTES);
    } catch (error) {
      if (error instanceof BodyError)
        return oauthError(res, 400, 'invalid_client_metadata', error.message);
      throw error;
    }
    const parsed = registrationSchema.safeParse(body);
    if (!parsed.success) {
      return oauthError(
        res,
        400,
        'invalid_client_metadata',
        'redirect_uris must list 1 to 10 URLs.',
      );
    }
    if (!parsed.data.redirect_uris.every((uri) => isAllowedRedirect(uri, redirectHosts))) {
      return oauthError(
        res,
        400,
        'invalid_redirect_uri',
        'Redirect URIs must use https on an allowed host, or http on localhost.',
      );
    }
    const name = parsed.data.client_name?.trim() || 'An AI assistant';
    const redirectUris = parsed.data.redirect_uris;
    sendJson(
      res,
      201,
      {
        client_id: sealer.seal('client', { name, redirectUris }, CLIENT_TTL),
        client_id_issued_at: Math.floor(now() / 1000),
        client_name: name,
        redirect_uris: redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      { pragma: 'no-cache' },
    );
  }

  /** Shows the sign-in page, allowing its form to redirect to the app's callback origin. */
  function showConsent(
    res: ServerResponse,
    status: number,
    details: { clientName: string; redirectUri: string; authorization: string; error?: string },
  ) {
    const { redirectUri, ...page } = details;
    sendHtml(res, status, consentPage(page), {
      redirectOrigin: new URL(redirectUri).origin,
      scriptSource: SCRIPT_SOURCE,
    });
  }

  /**
   * GET /oauth/authorize. Checks the client and the request, then shows the page that asks for a key.
   * A bad client or callback gets an error page and never a redirect, so the endpoint cannot be
   * used as an open redirect.
   */
  function authorizeGet(url: URL, res: ServerResponse) {
    const params = url.searchParams;
    const clientId = params.get('client_id') ?? '';
    const client = sealer.open('client', clientId, clientSchema);
    const redirectUri = params.get('redirect_uri') ?? '';
    if (
      !client?.redirectUris.includes(redirectUri) ||
      !isAllowedRedirect(redirectUri, redirectHosts)
    ) {
      return sendHtml(
        res,
        400,
        messagePage(
          'Cannot connect',
          'This sign-in link is not valid. Start again from your AI assistant.',
        ),
      );
    }

    const state = params.get('state') ?? undefined;
    const fail = (error: string, description: string) =>
      redirectTo(res, redirectUri, { error, error_description: description, state });
    const challenge = params.get('code_challenge') ?? '';
    const resource = params.get('resource')?.replace(/\/$/, '');

    if (params.get('response_type') !== 'code')
      return fail('unsupported_response_type', 'Only the code flow is supported.');
    if (params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
      return fail('invalid_request', 'PKCE with the S256 method is required.');
    }
    if (resource !== undefined && resource !== publicUrl && resource !== resourceUrl) {
      return fail('invalid_target', 'The resource is not this server.');
    }
    if (state !== undefined && state.length > 1024)
      return fail('invalid_request', 'The state value is too long.');

    const authorization = sealer.seal(
      'authorization',
      { clientId, clientName: client.name, redirectUri, challenge, state },
      AUTHORIZATION_TTL,
    );
    showConsent(res, 200, { clientName: client.name, redirectUri, authorization });
  }

  /** POST /oauth/authorize. Checks the key with Wassist, then redirects back with an authorization code. */
  async function authorizePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let form: URLSearchParams;
    try {
      form = await readFormBody(req, FORM_LIMIT_BYTES);
    } catch (error) {
      if (error instanceof BodyError)
        return sendHtml(res, error.status, messagePage('Cannot connect', error.message));
      throw error;
    }
    const sealed = form.get('authorization') ?? '';
    const request = sealer.open('authorization', sealed, authorizationSchema);
    if (!request) {
      return sendHtml(
        res,
        400,
        messagePage(
          'Link expired',
          'This sign-in took too long. Start again from your AI assistant.',
        ),
      );
    }

    const show = (status: number, error: string) =>
      showConsent(res, status, {
        clientName: request.clientName,
        redirectUri: request.redirectUri,
        authorization: sealed,
        error,
      });
    const apiKey = (form.get('api_key') ?? '').trim();
    if (!isValidApiKey(apiKey)) return show(400, 'Enter the key without spaces.');

    const verdict = await verifyKey(apiKey);
    if (verdict === 'rejected') return show(400, 'Wassist did not accept that key.');
    if (verdict === 'unavailable') return show(502, 'Could not reach Wassist. Try again.');

    const code = sealer.seal(
      'code',
      {
        apiKey,
        clientHash: clientHash(request.clientId),
        redirectUri: request.redirectUri,
        challenge: request.challenge,
        id: randomUUID(),
      },
      CODE_TTL,
    );
    redirectTo(res, request.redirectUri, { code, state: request.state });
  }

  /** GET shows the sign-in page and POST submits it. POST is rate limited. */
  async function authorize(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET') return authorizeGet(new URL(req.url ?? '/', publicUrl), res);
    if (req.method !== 'POST') return void methodNotAllowed(res, 'GET, POST');
    if (!limiter.check('authorize').allowed) {
      return sendHtml(res, 429, messagePage('Too many attempts', 'Wait a minute and try again.'));
    }
    await authorizePost(req, res);
  }

  /** Trades an authorization code and its PKCE verifier for tokens. A code works once. */
  function exchangeCode(form: URLSearchParams, res: ServerResponse) {
    const code = sealer.open('code', form.get('code') ?? '', codeSchema);
    const client = form.get('client_id') ?? '';
    if (
      !code ||
      code.clientHash !== clientHash(client) ||
      code.redirectUri !== form.get('redirect_uri') ||
      !pkceMatches(form.get('code_verifier') ?? '', code.challenge)
    ) {
      return oauthError(res, 400, 'invalid_grant', 'The authorization code is invalid or expired.');
    }
    const timeNow = now();
    for (const [id, expires] of usedCodes) if (expires <= timeNow) usedCodes.delete(id);
    if (usedCodes.has(code.id)) {
      return oauthError(res, 400, 'invalid_grant', 'The authorization code was already used.');
    }
    usedCodes.set(code.id, timeNow + CODE_TTL * 1000);
    sendJson(res, 200, issueTokens(code.apiKey, code.clientHash, randomUUID(), 0), {
      pragma: 'no-cache',
    });
  }

  /**
   * Trades a refresh token for a fresh pair and retires the old one. Presenting a retired token
   * revokes its whole family. A family this process has not seen, such as after a restart, is
   * accepted once and tracked from then on.
   */
  function refresh(form: URLSearchParams, res: ServerResponse) {
    const token = sealer.open('refresh', form.get('refresh_token') ?? '', refreshSchema);
    if (!token || token.clientHash !== clientHash(form.get('client_id') ?? '')) {
      return oauthError(res, 400, 'invalid_grant', 'The refresh token is invalid or expired.');
    }
    const current = families.get(token.family);
    if (current && current.generation !== token.generation) {
      families.set(token.family, { ...current, generation: REVOKED });
      return oauthError(
        res,
        400,
        'invalid_grant',
        'The refresh token was already used, so this sign-in has been ended. Sign in again.',
      );
    }
    sendJson(
      res,
      200,
      issueTokens(token.apiKey, token.clientHash, token.family, token.generation + 1),
      { pragma: 'no-cache' },
    );
  }

  /** POST /oauth/token. Handles both grant types. */
  async function token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return void methodNotAllowed(res, 'POST');
    if (!limiter.check('token').allowed)
      return oauthError(res, 429, 'slow_down', 'Too many requests.');
    let form: URLSearchParams;
    try {
      form = await readFormBody(req, FORM_LIMIT_BYTES);
    } catch (error) {
      if (error instanceof BodyError) return oauthError(res, 400, 'invalid_request', error.message);
      throw error;
    }
    const grant = form.get('grant_type');
    if (grant === 'authorization_code') return exchangeCode(form, res);
    if (grant === 'refresh_token') return refresh(form, res);
    oauthError(res, 400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
  }

  return {
    resourceMetadataUrl,

    async handle(req, res, pathname) {
      switch (pathname) {
        case '/.well-known/oauth-protected-resource':
        case '/.well-known/oauth-protected-resource/mcp':
          return metadata(req, res, protectedResource);
        case '/.well-known/oauth-authorization-server':
          return metadata(req, res, authorizationServer);
        case '/oauth/register':
          await register(req, res);
          return true;
        case '/oauth/authorize':
          await authorize(req, res);
          return true;
        case '/oauth/token':
          await token(req, res);
          return true;
        case FONT_PATH:
          if (req.method !== 'GET' && req.method !== 'HEAD')
            return methodNotAllowed(res, 'GET, HEAD');
          return serveFont(res, assets);
        default:
          return false;
      }
    },

    resolveToken(credential) {
      return isSealed(credential)
        ? sealer.open('access', credential, accessSchema)?.apiKey
        : credential;
    },
  };
}
