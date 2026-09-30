import { z } from 'zod';
import { VERSION } from '../version.js';
import { WassistApiError } from './errors.js';
import { WassistHttp } from './http.js';

/** valid: Wassist accepted the key. rejected: it refused it. unavailable: the check could not finish. */
export type KeyVerdict = 'valid' | 'rejected' | 'unavailable';

/**
 * Asks Wassist whether a key works, with one small read. The response body is ignored, so an
 * organization whose data has an unexpected shape is not mistaken for a bad key.
 */
export async function checkApiKey(apiKey: string, fetchImpl?: typeof fetch): Promise<KeyVerdict> {
  try {
    const http = new WassistHttp({
      apiKey,
      userAgent: `wassist-mcp-server/${VERSION}`,
      fetch: fetchImpl,
    });
    await http.request({ method: 'GET', path: '/agents/', query: { limit: 1 } }, z.unknown());
    return 'valid';
  } catch (error) {
    const rejected =
      error instanceof WassistApiError &&
      (error.kind === 'unauthorized' || error.kind === 'forbidden');
    return rejected ? 'rejected' : 'unavailable';
  }
}
