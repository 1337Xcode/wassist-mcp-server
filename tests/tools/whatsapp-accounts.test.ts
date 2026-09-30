import { afterEach, describe, expect, it } from 'vitest';
import { FakeWassist, json } from '../helpers/fake-wassist.js';
import { connectTools, type Session } from '../helpers/mcp.js';

// The client under test, closed after each test.
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

// A link session as Wassist returns it.
const linkSession = {
  id: 'b1e8a4c2-0000-4000-8000-000000000001',
  successUrl: 'https://wassist.app/',
  returnUrl: 'https://wassist.app/',
  status: 'PENDING',
  linkUrl: 'https://wassist.app/link/abc123',
};

describe('wassist_create_whatsapp_link', () => {
  it('creates a link with the default redirects and hands back the address to open', async () => {
    const fake = new FakeWassist().on(
      'POST',
      '/api/v1/whatsapp-link-sessions/',
      json(linkSession, 201),
    );
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_create_whatsapp_link');

    expect(isError).toBe(false);
    expect(data).toEqual({
      id: linkSession.id,
      status: 'PENDING',
      linkUrl: 'https://wassist.app/link/abc123',
    });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.body).toEqual({
      successUrl: 'https://wassist.app/',
      returnUrl: 'https://wassist.app/',
    });
  });

  it('passes the redirects it is given', async () => {
    const fake = new FakeWassist().on(
      'POST',
      '/api/v1/whatsapp-link-sessions/',
      json(linkSession, 201),
    );
    session = await connectTools(fake);
    await session.call('wassist_create_whatsapp_link', {
      successUrl: 'https://example.com/done',
      returnUrl: 'https://example.com/cancelled',
    });

    expect(fake.requests[0]?.body).toEqual({
      successUrl: 'https://example.com/done',
      returnUrl: 'https://example.com/cancelled',
    });
  });

  it.each([
    ['a plain http address', { successUrl: 'http://example.com/done' }],
    ['something that is not an address', { returnUrl: 'not a url' }],
    ['a script address', { successUrl: 'javascript:alert(1)' }],
  ])('rejects %s as a redirect without calling Wassist', async (_label, args) => {
    const fake = new FakeWassist();
    session = await connectTools(fake);
    const { isError } = await session.call('wassist_create_whatsapp_link', args);

    expect(isError).toBe(true);
    expect(fake.requests).toHaveLength(0);
  });

  it('does not retry the write, and says the outcome is unknown', async () => {
    const fake = new FakeWassist().on('POST', '/api/v1/whatsapp-link-sessions/', json({}, 503));
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_create_whatsapp_link');

    expect(isError).toBe(true);
    expect(data.error.outcomeUnknown).toBe(true);
    expect(fake.requests).toHaveLength(1);
  });
});
