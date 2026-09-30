import type { z } from 'zod';
import { WassistApiError, type WassistErrorKind } from './errors.js';

// Fixed on purpose: no tool or setting can point requests at another host.
const WASSIST_ORIGIN = 'https://backend.wassist.app';

/** Version prefix that every request path goes under. */
const API_PREFIX = '/api/v1';
// How long one attempt may take, in milliseconds. It covers reading the body too.
const DEFAULT_TIMEOUT_MS = 30_000;
// Larger responses are refused, so one call cannot pull an unbounded body into memory.
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
// Total tries for a GET, including the first. Writes are never retried.
const MAX_ATTEMPTS = 3;
// A longer Retry-After is reported to the caller instead of waited out.
const MAX_RETRY_WAIT_MS = 10_000;
// Upstream error text longer than this is cut, so a verbose body cannot flood the model.
const MAX_MESSAGE_LENGTH = 300;
// Printable ASCII only, so a key cannot carry spaces or line breaks into a header.
const API_KEY_PATTERN = /^[\x21-\x7e]{1,512}$/;

/** What a query parameter may hold. `undefined` leaves it out. */
type QueryValue = string | number | boolean | undefined;

/** One request to make: the method, the path under /api/v1, and an optional query and JSON body. */
export interface RequestSpec {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
}

/** Settings for one `WassistHttp`. Tests replace `fetch` and `sleep`. */
export interface WassistHttpOptions {
  apiKey: string;
  userAgent: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Builds an API path and percent-encodes every interpolated value. */
export function apiPath(strings: TemplateStringsArray, ...values: string[]): string {
  return strings.reduce((path, part, index) => {
    const value = values[index];
    return path + part + (value === undefined ? '' : encodeURIComponent(value));
  }, '');
}

/** True for a printable ASCII key of 1 to 512 characters. */
export function isValidApiKey(value: string): boolean {
  return API_KEY_PATTERN.test(value);
}

/**
 * Sends requests to the fixed Wassist API origin on behalf of one caller. The retry and error rules
 * are described in docs/architecture.md.
 */
export class WassistHttp {
  private readonly apiKey: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(options: WassistHttpOptions) {
    if (!isValidApiKey(options.apiKey)) {
      throw new WassistApiError('unauthorized', 'The Wassist API key is empty or malformed.');
    }
    this.apiKey = options.apiKey;
    this.userAgent = options.userAgent;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sleep = options.sleep ?? abortableSleep;
  }

  /**
   * Sends the request, validates the body against `schema` and returns it.
   * Every failure is a WassistApiError.
   */
  async request<T>(spec: RequestSpec, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    const url = this.buildUrl(spec);
    for (let attempt = 1; ; attempt++) {
      try {
        const body = await this.send(url, spec, signal);
        return this.parseBody(body, schema, spec);
      } catch (error) {
        const delayMs = retryDelayMs(error, spec, attempt);
        if (delayMs === undefined) throw error;
        await this.sleep(delayMs, signal);
      }
    }
  }

  /** Waits, ending early with a cancelled error when the caller aborts. Tests replace the sleep behind it. */
  pause(ms: number, signal?: AbortSignal): Promise<void> {
    return this.sleep(ms, signal);
  }

  /** Puts the path under the fixed origin and adds the query. Refuses anything that would leave that origin. */
  private buildUrl(spec: RequestSpec): URL {
    const url = new URL(`${API_PREFIX}${spec.path}`, WASSIST_ORIGIN);
    for (const [key, value] of Object.entries(spec.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    if (url.origin !== WASSIST_ORIGIN) {
      throw new WassistApiError(
        'invalid_request',
        'The request path escaped the Wassist API origin.',
      );
    }
    return url;
  }

  /** Makes one attempt: sends the request, reads the capped body and turns an error status into an error. */
  private async send(url: URL, spec: RequestSpec, callerSignal?: AbortSignal): Promise<string> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
    const headers: Record<string, string> = {
      'X-API-Key': this.apiKey,
      Accept: 'application/json',
      'User-Agent': this.userAgent,
    };
    if (spec.body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(url, {
        method: spec.method,
        headers,
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
        redirect: 'manual',
        signal,
      });
      text = await readCapped(response);
    } catch (error) {
      if (error instanceof WassistApiError) throw error;
      throw transportError(error, callerSignal, spec);
    }

    if (response.status >= 300 && response.status < 400) {
      throw new WassistApiError(
        'upstream_error',
        'Wassist answered with a redirect, which this server never follows.',
        {
          status: response.status,
        },
      );
    }
    if (response.status >= 400) throw this.errorFromResponse(response, text, spec);
    return text;
  }

  /** Parses the JSON body and checks it against the schema. A bad shape names the field and never shows its value. */
  private parseBody<T>(text: string, schema: z.ZodType<T>, spec: RequestSpec): T {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new WassistApiError(
        'invalid_response',
        'Wassist returned a body that is not valid JSON.',
        {
          outcomeUnknown: spec.method !== 'GET',
        },
      );
    }
    const result = schema.safeParse(json);
    if (result.success) return result.data;
    const paths = result.error.issues.slice(0, 3).map((issue) => issue.path.join('.') || '(root)');
    throw new WassistApiError(
      'invalid_response',
      `Wassist returned data in an unexpected shape at ${paths.join(', ')}.`,
      {
        outcomeUnknown: spec.method !== 'GET',
      },
    );
  }

  /** Builds the error for a 4xx or 5xx answer. Wassist's own text is used only for validation failures. */
  private errorFromResponse(response: Response, text: string, spec: RequestSpec): WassistApiError {
    const status = response.status;
    const body = parseJson(text);
    const requestId = response.headers.get('x-request-id') ?? undefined;
    const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'), body);
    const kind = kindForStatus(status);
    const detail = status === 400 || status === 422 ? describeBody(body, this.apiKey) : undefined;
    const outcomeUnknown = spec.method !== 'GET' && status >= 500;
    return new WassistApiError(kind, detail ?? defaultMessage(kind), {
      status,
      requestId,
      retryAfterSeconds,
      outcomeUnknown,
    });
  }
}

/** Maps an HTTP status to the failure code that tools report. */
function kindForStatus(status: number): WassistErrorKind {
  if (status === 400 || status === 422) return 'invalid_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  return 'upstream_error';
}

/** The message for a failure when Wassist gave no usable text. */
function defaultMessage(kind: WassistErrorKind): string {
  switch (kind) {
    case 'invalid_request':
      return 'Wassist rejected the request as invalid.';
    case 'unauthorized':
      return 'Wassist rejected the API key.';
    case 'forbidden':
      return 'The API key is not allowed to perform this action.';
    case 'not_found':
      return 'Wassist could not find that resource.';
    case 'conflict':
      return 'The request conflicts with the current state of the resource.';
    case 'rate_limited':
      return 'Wassist rate limit reached.';
    default:
      return 'Wassist failed to process the request.';
  }
}

/** Classifies a fetch that threw: cancelled by the caller, timed out, or could not connect. */
function transportError(
  error: unknown,
  callerSignal: AbortSignal | undefined,
  spec: RequestSpec,
): WassistApiError {
  const outcomeUnknown = spec.method !== 'GET';
  if (callerSignal?.aborted)
    return new WassistApiError('cancelled', 'The request was cancelled.', { outcomeUnknown });
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new WassistApiError('timeout', 'Wassist did not answer in time.', { outcomeUnknown });
  }
  return new WassistApiError('network_error', 'Could not reach the Wassist API.', {
    outcomeUnknown,
  });
}

/** How long to wait before a retry, or undefined to give up. Only GETs retry, and only on rate limits and transient failures. */
function retryDelayMs(error: unknown, spec: RequestSpec, attempt: number): number | undefined {
  if (spec.method !== 'GET' || attempt >= MAX_ATTEMPTS || !(error instanceof WassistApiError))
    return undefined;
  const { status, retryAfterSeconds } = error.details;
  if (error.kind === 'rate_limited') {
    if (retryAfterSeconds === undefined) return backoffMs(attempt);
    const waitMs = retryAfterSeconds * 1000;
    return waitMs <= MAX_RETRY_WAIT_MS ? waitMs : undefined;
  }
  const transient =
    error.kind === 'network_error' || status === 502 || status === 503 || status === 504;
  return transient ? backoffMs(attempt) : undefined;
}

/** Exponential backoff from 500 ms, capped at 4 s, with up to 250 ms of jitter. */
function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 4_000) + Math.floor(Math.random() * 250);
}

/** A pause that ends early with a cancelled error when the caller aborts. */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new WassistApiError('cancelled', 'The request was cancelled.'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new WassistApiError('cancelled', 'The request was cancelled.'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Reads the body while counting bytes, so an oversized response is cut off early. */
async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw tooLarge();
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      void reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** The error for a response over the size cap. */
function tooLarge(): WassistApiError {
  return new WassistApiError(
    'invalid_response',
    'The Wassist response was larger than the 2 MiB limit.',
  );
}

/** Parses JSON, or returns undefined when the text is not JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Reads Retry-After as seconds or a date, falling back to the `retry_after` field in a 429 body. */
function parseRetryAfter(header: string | null, body: unknown): number | undefined {
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  }
  if (isRecord(body) && typeof body.retry_after === 'number' && body.retry_after >= 0) {
    return Math.ceil(body.retry_after);
  }
  return undefined;
}

/** True for a plain object, which is what upstream error bodies usually are. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Turns an upstream validation body into one short line, or undefined when nothing usable
 * is present.
 */
function describeBody(body: unknown, apiKey: string): string | undefined {
  if (!isRecord(body)) return undefined;
  for (const key of ['detail', 'error', 'message']) {
    const value = body[key];
    if (typeof value === 'string') return sanitize(value, apiKey);
  }
  const fields = Object.entries(body).flatMap(([field, value]) => {
    const messages = (Array.isArray(value) ? value : [value]).filter(
      (item) => typeof item === 'string',
    );
    return messages.length > 0 ? [`${field}: ${messages.join(' ')}`] : [];
  });
  return fields.length > 0 ? sanitize(fields.join('; '), apiKey) : undefined;
}

/** Removes the key, control characters and excess length from text that came from Wassist. */
function sanitize(text: string, apiKey: string): string {
  const cleaned = text
    .split(apiKey)
    .join('[redacted]')
    .replace(/\p{Cc}/gu, ' ')
    .trim();
  return cleaned.length > MAX_MESSAGE_LENGTH
    ? `${cleaned.slice(0, MAX_MESSAGE_LENGTH)}...`
    : cleaned;
}
