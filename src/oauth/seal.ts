import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { z } from 'zod';

// Marks a token as ours and names its format, so the format can change later.
const PREFIX = 'wsm1';
// AES-GCM sizes: a 96-bit nonce, and a full 128-bit tag so a shortened tag cannot pass.
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** What every sealed token holds: the payload and the time it expires. */
const envelope = z.object({ exp: z.number(), data: z.unknown() });

/** The step a token belongs to. It is authenticated with the token, so tokens cannot cross steps. */
type SealPurpose = 'client' | 'authorization' | 'code' | 'access' | 'refresh';

/**
 * Turns small payloads into opaque tokens that nobody can read, change or extend, and that expire.
 * The server keeps no session store, so everything it needs to remember travels inside the token.
 * The purpose is authenticated with the ciphertext, so a token made for one step fails at another.
 */
export class Sealer {
  private readonly key: Buffer;

  constructor(
    secret: string,
    private readonly now: () => number = Date.now,
  ) {
    this.key = Buffer.from(
      hkdfSync('sha256', secret, 'wassist-mcp-server', 'token-sealing-v1', 32),
    );
  }

  /** Encrypts and authenticates `data` for `purpose`. The token stops working after `ttlSeconds`. */
  seal(purpose: SealPurpose, data: unknown, ttlSeconds: number): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(purpose));
    const exp = Math.floor(this.now() / 1000) + ttlSeconds;
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify({ exp, data }), 'utf8'),
      cipher.final(),
    ]);
    return [
      PREFIX,
      ...[iv, ciphertext, cipher.getAuthTag()].map((part) => part.toString('base64url')),
    ].join('.');
  }

  /**
   * Returns the payload when the token is authentic, unexpired, made for `purpose` and fits
   * `schema`.
   */
  open<S extends z.ZodType>(
    purpose: SealPurpose,
    token: string,
    schema: S,
  ): z.output<S> | undefined {
    const [prefix, iv, ciphertext, tag, ...extra] = token.split('.');
    if (prefix !== PREFIX || !iv || !ciphertext || !tag || extra.length > 0) return undefined;
    try {
      const ivBytes = Buffer.from(iv, 'base64url');
      const tagBytes = Buffer.from(tag, 'base64url');
      if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES) return undefined;

      const decipher = createDecipheriv('aes-256-gcm', this.key, ivBytes, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(Buffer.from(purpose));
      decipher.setAuthTag(tagBytes);
      const json = Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');

      const opened = envelope.parse(JSON.parse(json));
      if (opened.exp <= this.now() / 1000) return undefined;
      const parsed = schema.safeParse(opened.data);
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }
}

/** True for a token that this server issued, whether or not it is still valid. */
export function isSealed(token: string): boolean {
  return token.startsWith(`${PREFIX}.`);
}
