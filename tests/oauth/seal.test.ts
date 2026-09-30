import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isSealed, Sealer } from '../../src/oauth/seal.js';

// Any secret of 32 or more characters will do.
const SECRET = 'seal-test-secret-0123456789abcdef0123456789';
const schema = z.object({ apiKey: z.string() });

describe('Sealer', () => {
  it('opens what it sealed', () => {
    const sealer = new Sealer(SECRET);
    const token = sealer.seal('access', { apiKey: 'secret-value' }, 60);

    expect(sealer.open('access', token, schema)).toEqual({ apiKey: 'secret-value' });
    expect(isSealed(token)).toBe(true);
  });

  it('keeps the payload unreadable', () => {
    const token = new Sealer(SECRET).seal('access', { apiKey: 'secret-value-to-hide' }, 60);
    const decoded = token
      .split('.')
      .map((part) => Buffer.from(part, 'base64url').toString('latin1'))
      .join('');

    expect(token).not.toContain('secret-value-to-hide');
    expect(decoded).not.toContain('secret-value-to-hide');
  });

  it('gives every token a fresh nonce', () => {
    const sealer = new Sealer(SECRET);

    expect(sealer.seal('access', { apiKey: 'a' }, 60)).not.toBe(
      sealer.seal('access', { apiKey: 'a' }, 60),
    );
  });

  it('refuses a token made for another purpose', () => {
    const sealer = new Sealer(SECRET);
    const token = sealer.seal('refresh', { apiKey: 'a' }, 60);

    expect(sealer.open('access', token, schema)).toBeUndefined();
  });

  it('refuses a token sealed with another secret', () => {
    const token = new Sealer(SECRET).seal('access', { apiKey: 'a' }, 60);

    expect(new Sealer(`${SECRET}-changed`).open('access', token, schema)).toBeUndefined();
  });

  it('refuses a token that was changed by one character', () => {
    const sealer = new Sealer(SECRET);
    const token = sealer.seal('access', { apiKey: 'a' }, 60);
    const [prefix, iv, body, tag] = token.split('.');
    const flipped = `${body?.startsWith('A') ? 'B' : 'A'}${body?.slice(1)}`;

    expect(sealer.open('access', [prefix, iv, flipped, tag].join('.'), schema)).toBeUndefined();
  });

  it('refuses malformed input without throwing', () => {
    const sealer = new Sealer(SECRET);

    for (const junk of ['', 'wsm1', 'wsm1.a.b', 'wsm1.a.b.c.d', 'not-a-token', 'wsm1....']) {
      expect(sealer.open('access', junk, schema)).toBeUndefined();
    }
  });

  it('refuses a payload that does not fit the expected shape', () => {
    const sealer = new Sealer(SECRET);
    const token = sealer.seal('access', { somethingElse: true }, 60);

    expect(sealer.open('access', token, schema)).toBeUndefined();
  });

  it('expires', () => {
    let now = Date.parse('2026-01-01T00:00:00Z');
    const sealer = new Sealer(SECRET, () => now);
    const token = sealer.seal('access', { apiKey: 'a' }, 60);

    now += 59_000;
    expect(sealer.open('access', token, schema)).toEqual({ apiKey: 'a' });
    now += 2_000;
    expect(sealer.open('access', token, schema)).toBeUndefined();
  });
});
