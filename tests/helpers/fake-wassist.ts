import { WassistHttp } from '../../src/wassist/http.js';

/** The key the tests give the client. Redaction tests look for it in every output. */
export const TEST_API_KEY = 'test-key-0123456789abcdef';

/** A request the fake received, kept so tests can assert exactly what was sent. */
export interface RecordedRequest {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

/** Builds the answer to one request. */
export type Responder = (request: RecordedRequest) => Response | Promise<Response>;

/** One described endpoint. */
interface Route {
  method: string;
  path: string | RegExp;
  respond: Responder;
}

/** A JSON Response, for describing what the fake answers. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Real fetch rejects when its signal aborts, so the fake has to as well. */
function abortable(pending: Response | Promise<Response>, signal?: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    Promise.resolve(pending).then(resolve, reject);
  });
}

/** An in-memory stand-in for the Wassist API. It fails loudly on any request nobody described. */
export class FakeWassist {
  readonly requests: RecordedRequest[] = [];
  private readonly routes: Route[] = [];

  /** Describes an endpoint. `respond` is a fixed body, a Response, or a function that decides per request. */
  on(
    method: string,
    path: string | RegExp,
    respond: Responder | Response | Record<string, unknown> | unknown[],
  ): this {
    const responder: Responder =
      typeof respond === 'function'
        ? (respond as Responder)
        : () => (respond instanceof Response ? respond.clone() : json(respond));
    this.routes.push({ method, path, respond: responder });
    return this;
  }

  /** Stands in for the global fetch. It fails on a request that no route describes. */
  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const rawBody = typeof init?.body === 'string' ? init.body : undefined;
    const request: RecordedRequest = {
      method,
      url,
      headers: new Headers(init?.headers),
      body: rawBody === undefined ? undefined : JSON.parse(rawBody),
    };
    this.requests.push(request);

    const route = this.routes.find(
      (candidate) =>
        candidate.method === method &&
        (typeof candidate.path === 'string'
          ? candidate.path === url.pathname
          : candidate.path.test(url.pathname)),
    );
    if (!route) throw new Error(`FakeWassist: no route for ${method} ${url.pathname}`);
    return abortable(route.respond(request), init?.signal ?? undefined);
  };

  /** A WassistHttp wired to this fake, with a test key and options for timeouts and sleeping. */
  createHttp(
    overrides: { apiKey?: string; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
  ): WassistHttp {
    return new WassistHttp({
      apiKey: overrides.apiKey ?? TEST_API_KEY,
      userAgent: 'wassist-mcp-tests/0.0.0',
      fetch: this.fetch,
      timeoutMs: overrides.timeoutMs,
      sleep: overrides.sleep ?? (async () => undefined),
    });
  }
}
