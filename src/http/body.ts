import type { IncomingMessage } from 'node:http';

/** A request body that cannot be used. `status` is the HTTP status to answer with. */
export class BodyError extends Error {
  constructor(
    readonly status: 400 | 413 | 415,
    message: string,
  ) {
    super(message);
    this.name = 'BodyError';
  }
}

/** Reads a request body as text, stopping as soon as it grows past the limit. */
async function readText(
  req: IncomingMessage,
  maxBytes: number,
  contentType: string,
): Promise<string> {
  if (!req.headers['content-type']?.toLowerCase().startsWith(contentType)) {
    throw new BodyError(415, `Content-Type must be ${contentType}.`);
  }
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new BodyError(413, 'Request body is too large.');

  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    received += buffer.length;
    if (received > maxBytes) throw new BodyError(413, 'Request body is too large.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Reads a JSON request body. */
export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const text = await readText(req, maxBytes, 'application/json');
  try {
    return JSON.parse(text);
  } catch {
    throw new BodyError(400, 'Request body is not valid JSON.');
  }
}

/** Reads an `application/x-www-form-urlencoded` body, as sent by browsers and OAuth clients. */
export async function readFormBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<URLSearchParams> {
  return new URLSearchParams(await readText(req, maxBytes, 'application/x-www-form-urlencoded'));
}
