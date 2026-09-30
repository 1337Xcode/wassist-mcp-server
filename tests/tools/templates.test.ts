import { afterEach, describe, expect, it } from 'vitest';
import { FakeWassist, json } from '../helpers/fake-wassist.js';
import { ACCOUNT_ID, TEMPLATE_ID, upstreamTemplate } from '../helpers/fixtures.js';
import { connectTools, type Session } from '../helpers/mcp.js';

// The client under test, closed after each test.
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe('wassist_list_templates', () => {
  it('lists a bare-array response with review status per account', async () => {
    const template = upstreamTemplate({
      accountLinks: [
        {
          accountId: ACCOUNT_ID,
          accountName: 'Acme Ltd',
          wabaId: '555',
          metaTemplateId: 'm1',
          status: 'APPROVED',
          qualityScore: 'GREEN',
          rejectionReason: null,
        },
      ],
    });
    const fake = new FakeWassist().on('GET', '/api/v1/whatsapp-templates/', [template]);
    session = await connectTools(fake);
    const { data } = await session.call('wassist_list_templates');

    expect(data).toEqual({
      items: [
        {
          id: TEMPLATE_ID,
          name: 'order_update',
          category: 'UTILITY',
          language: 'en',
          parameterFormat: 'POSITIONAL',
          components: [{ type: 'BODY', text: 'Hi {{1}}, your order {{2}} shipped.' }],
          accountLinks: [
            {
              accountId: ACCOUNT_ID,
              accountName: 'Acme Ltd',
              status: 'APPROVED',
              rejectionReason: null,
            },
          ],
        },
      ],
      total: 1,
      nextOffset: null,
    });
  });
});

describe('wassist_create_template', () => {
  it('creates a draft and sends only the fields that were passed', async () => {
    const fake = new FakeWassist().on(
      'POST',
      '/api/v1/whatsapp-templates/',
      json(upstreamTemplate(), 201),
    );
    session = await connectTools(fake);
    const { data } = await session.call('wassist_create_template', {
      name: 'order_update',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'Hi {{1}}, your order {{2}} shipped.' }],
    });

    expect(fake.requests[0]?.body).toEqual({
      name: 'order_update',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'Hi {{1}}, your order {{2}} shipped.' }],
    });
    expect(data.id).toBe(TEMPLATE_ID);
    expect(data.accountLinks).toEqual([]);
  });

  it('rejects an unknown category and unknown component fields', async () => {
    const fake = new FakeWassist();
    session = await connectTools(fake);

    expect(
      (await session.call('wassist_create_template', { name: 'x', category: 'PROMO' })).isError,
    ).toBe(true);
    expect(
      (
        await session.call('wassist_create_template', {
          name: 'x',
          category: 'UTILITY',
          components: [{ type: 'BODY', script: '<b>' }],
        })
      ).isError,
    ).toBe(true);
    expect(fake.requests).toHaveLength(0);
  });
});

describe('wassist_update_template', () => {
  it('patches only the passed fields', async () => {
    const fake = new FakeWassist().on(
      'PATCH',
      `/api/v1/whatsapp-templates/${TEMPLATE_ID}/`,
      upstreamTemplate({ language: 'en_GB' }),
    );
    session = await connectTools(fake);
    const { data } = await session.call('wassist_update_template', {
      templateId: TEMPLATE_ID,
      language: 'en_GB',
    });

    expect(fake.requests[0]?.body).toEqual({ language: 'en_GB' });
    expect(data.language).toBe('en_GB');
  });
});

describe('wassist_publish_template', () => {
  it('submits the template to the chosen accounts and surfaces per-account failures', async () => {
    const published = upstreamTemplate({
      accountLinks: [
        {
          accountId: ACCOUNT_ID,
          accountName: 'Acme Ltd',
          status: 'PENDING',
          rejectionReason: null,
        },
      ],
      publishErrors: [
        { accountId: '9d1c7e5a-1111-4222-8333-444455556666', error: 'Account is not verified.' },
      ],
    });
    const fake = new FakeWassist().on(
      'POST',
      `/api/v1/whatsapp-templates/${TEMPLATE_ID}/publish/`,
      published,
    );
    session = await connectTools(fake);
    const { data } = await session.call('wassist_publish_template', {
      templateId: TEMPLATE_ID,
      accountIds: [ACCOUNT_ID],
    });

    expect(fake.requests[0]?.body).toEqual({ accountIds: [ACCOUNT_ID] });
    expect(data.accountLinks[0].status).toBe('PENDING');
    expect(data.publishErrors).toEqual([
      { accountId: '9d1c7e5a-1111-4222-8333-444455556666', error: 'Account is not verified.' },
    ]);
  });

  it('requires at least one account', async () => {
    const fake = new FakeWassist();
    session = await connectTools(fake);
    const { isError } = await session.call('wassist_publish_template', {
      templateId: TEMPLATE_ID,
      accountIds: [],
    });

    expect(isError).toBe(true);
    expect(fake.requests).toHaveLength(0);
  });
});

describe('wassist_list_whatsapp_accounts', () => {
  it('lists linked accounts and handles an empty organization', async () => {
    const fake = new FakeWassist().on('GET', '/api/v1/whatsapp-accounts/', []);
    session = await connectTools(fake);
    const { data } = await session.call('wassist_list_whatsapp_accounts');

    expect(data).toEqual({ items: [], total: 0, nextOffset: null });
  });
});
