import type { ServerResponse } from 'node:http';

/** Headers on every response: never cached, and never sniffed into another content type. */
const BASE_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

/** Writes a JSON response that clients and proxies must not cache. */
export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { ...BASE_HEADERS, 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

/** What an HTML page may do beyond showing itself. */
interface HtmlOptions {
  /**
   * An origin the page's form may redirect to. Browsers check a form's redirect against
   * form-action too, and would otherwise block the trip back to the app after sign-in.
   */
  redirectOrigin?: string;
  /** A CSP source, such as a script hash, for the only script the page may run. */
  scriptSource?: string;
}

/**
 * Writes an HTML page that cannot be framed or cached. It may load fonts from this server, run
 * only the script named in `options`, and post its form only back here.
 */
export function sendHtml(
  res: ServerResponse,
  status: number,
  html: string,
  { redirectOrigin, scriptSource }: HtmlOptions = {},
): void {
  const formTargets = redirectOrigin ? `'self' ${redirectOrigin}` : "'self'";
  const scripts = scriptSource ? `; script-src ${scriptSource}` : '';
  res.writeHead(status, {
    ...BASE_HEADERS,
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; font-src 'self'${scripts}; form-action ${formTargets}; frame-ancestors 'none'; base-uri 'none'`,
    'x-frame-options': 'DENY',
    // Not no-referrer: with that policy browsers send "Origin: null" on the form POST, and the origin check rejects it.
    'referrer-policy': 'same-origin',
  });
  res.end(html);
}
