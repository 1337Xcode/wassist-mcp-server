import type { IncomingHttpHeaders } from 'node:http';

// Printable ASCII, long enough for a sealed OAuth token.
// The Wassist key itself is checked again once the token is opened.
const CREDENTIAL_PATTERN = /^[\x21-\x7e]{1,2048}$/;

/**
 * Reads the caller's credential from X-API-Key or an Authorization bearer header. It is either a
 * Wassist API key or an access token issued by this server. A credential in the URL is never
 * accepted because URLs end up in logs and browser history.
 */
export function extractCredential(headers: IncomingHttpHeaders): string | undefined {
  const direct = headers['x-api-key'];
  const authorization = headers.authorization;
  if (Array.isArray(direct) || Array.isArray(authorization)) return undefined;

  const bearer =
    authorization === undefined ? undefined : /^Bearer\s+(\S+)$/i.exec(authorization.trim())?.[1];
  const credential = (direct ?? bearer)?.trim();
  return credential !== undefined && CREDENTIAL_PATTERN.test(credential) ? credential : undefined;
}
