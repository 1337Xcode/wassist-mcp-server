import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { hostHeaderValidation, originValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { type AuthInfo, createMcpHandler } from '@modelcontextprotocol/server';
import { createWassistApi } from '../api.js';
import type { HttpConfig } from '../config.js';
import { logger } from '../logger.js';
import { createOAuth } from '../oauth/handler.js';
import { createWassistServer } from '../server.js';
import { selectTools } from '../tools.js';
import { VERSION } from '../version.js';
import { isValidApiKey, WassistHttp } from '../wassist/http.js';
import { checkApiKey } from '../wassist/verify.js';
import { BodyError, readJsonBody } from './body.js';
import { extractCredential } from './credentials.js';
import { RateLimiter } from './rate-limit.js';
import { sendJson } from './respond.js';

/** Host names that always reach the server, so local tools work without an allow-list. */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
// Node limits: the whole request, the headers alone, and how long shutdown waits before it drops connections.
const REQUEST_TIMEOUT_MS = 120_000;
const HEADERS_TIMEOUT_MS = 20_000;
const SHUTDOWN_GRACE_MS = 5_000;

/** A running HTTP server and the way to stop it. */
export interface HttpApp {
  server: Server;
  close(): Promise<void>;
}

/** What the HTTP server needs to start. */
export interface HttpAppOptions {
  config: HttpConfig;
  /** Replaces the global fetch used to reach Wassist. Tests use it to avoid the network. */
  fetch?: typeof fetch;
}

/** A JSON-RPC error body, for problems found before the MCP layer sees the request. */
const rpcError = (code: number, message: string) => ({
  jsonrpc: '2.0',
  error: { code, message },
  id: null,
});

/** Hashes a key so the rate limiter can count per key without holding the key itself. */
const fingerprint = (apiKey: string): string => createHash('sha256').update(apiKey).digest('hex');

/**
 * Serves MCP over Streamable HTTP. Each request carries its caller's own Wassist API key, either
 * directly or inside an access token from the optional OAuth sign-in. A fresh server is built for
 * that request only, so the process holds no organization credential of its own.
 */
export function createHttpApp({ config, fetch }: HttpAppOptions): HttpApp {
  const tools = selectTools(config.tools);
  const mcp = createMcpHandler(
    ({ authInfo }) => {
      if (!authInfo) throw new Error('The MCP handler was called without caller credentials.');
      const http = new WassistHttp({
        apiKey: authInfo.token,
        userAgent: `wassist-mcp-server/${VERSION}`,
        fetch,
      });
      return createWassistServer({ api: createWassistApi(http), tools });
    },
    { onerror: (error) => logger.warn('mcp request failed', { error: error.message }) },
  );
  const serveMcp = toNodeHandler(mcp, {
    onerror: (error) => logger.error('mcp adapter error', { error: error.message }),
  });

  const oauth = config.oauth
    ? createOAuth({
        publicUrl: config.oauth.publicUrl,
        secret: config.oauth.secret,
        redirectHosts: config.oauth.redirectHosts,
        verifyKey: (apiKey) => checkApiKey(apiKey, fetch),
      })
    : undefined;
  const validateHost = hostHeaderValidation([...LOOPBACK_HOSTS, ...config.allowedHosts]);
  const validateOrigin = originValidation([...LOOPBACK_HOSTS, ...config.allowedHosts]);
  const limiter = new RateLimiter(config.rateLimitPerMinute);

  /** Answers 401 with a WWW-Authenticate header, which points at the sign-in when that is on. */
  function challenge(res: ServerResponse, presented: boolean): void {
    const parts = ['Bearer realm="wassist-mcp-server"'];
    if (oauth) parts.push(`resource_metadata="${oauth.resourceMetadataUrl}"`);
    if (presented) parts.push('error="invalid_token"');
    const hint = oauth
      ? 'Sign in through your AI assistant, or send your Wassist API key in the X-API-Key header.'
      : 'Send your Wassist API key in the X-API-Key header or as an Authorization bearer token.';
    sendJson(res, 401, rpcError(-32001, hint), { 'www-authenticate': parts.join(', ') });
  }

  /** Routes one request: the health check, the sign-in endpoints, then the MCP endpoint. */
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/healthz') return sendJson(res, 200, { status: 'ok', version: VERSION });

    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    if (oauth && (await oauth.handle(req, res, path))) return;
    if (path !== '/mcp') return sendJson(res, 404, { error: 'not_found' });

    const credential = extractCredential(req.headers);
    const apiKey = credential !== undefined && oauth ? oauth.resolveToken(credential) : credential;
    if (apiKey === undefined || !isValidApiKey(apiKey))
      return challenge(res, credential !== undefined);

    const verdict = limiter.check(fingerprint(apiKey));
    if (!verdict.allowed) {
      return sendJson(res, 429, rpcError(-32002, 'Too many requests. Slow down and retry.'), {
        'retry-after': String(verdict.retryAfterSeconds),
      });
    }

    const body = req.method === 'POST' ? await readJsonBody(req, config.maxBodyBytes) : undefined;
    const auth: AuthInfo = { token: apiKey, clientId: 'wassist-api-key', scopes: [] };
    await serveMcp(Object.assign(req, { auth }), res, body);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) return void res.end();
      if (error instanceof BodyError)
        return sendJson(res, error.status, rpcError(-32600, error.message));
      logger.error('http request failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      sendJson(res, 500, rpcError(-32603, 'Internal server error.'));
    });
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;

  return {
    server,
    async close() {
      await mcp.close();
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeIdleConnections();
      const force = setTimeout(() => server.closeAllConnections(), SHUTDOWN_GRACE_MS);
      await closed;
      clearTimeout(force);
    },
  };
}
