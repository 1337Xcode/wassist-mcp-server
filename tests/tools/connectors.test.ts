import { afterEach, describe, expect, it } from 'vitest';
import { FakeWassist } from '../helpers/fake-wassist.js';
import { connectTools, type Session } from '../helpers/mcp.js';

// The client under test, closed after each test.
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

/** A connector as the live API returns it, with a token in its URL that must never be shown. */
function upstreamConnector(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c0c0c0c0-0000-4000-8000-000000000001',
    name: 'Stripe',
    description: 'Payments, invoices and refunds.',
    url: 'https://mcp.stripe.com/mcp?token=sk_live_CONNECTOR_TOKEN',
    status: 'UNKNOWN',
    slug: 'stripe',
    logo: { name: 'stripe.png', path: 'x', size: 1, url: 'https://cdn.example/stripe.png' },
    knownTools: [
      { id: 't1', name: 'list_invoices', description: 'Lists invoices', inputSchema: {} },
      { id: 't2', name: 'create_refund', description: 'Refunds', inputSchema: {} },
    ],
    ...overrides,
  };
}

describe('wassist_list_connectors', () => {
  it('lists the organization connectors with their host and tool names only', async () => {
    const fake = new FakeWassist().on('GET', '/api/v1/integrations/connectors/', [
      upstreamConnector(),
    ]);
    session = await connectTools(fake);
    const { data } = await session.call('wassist_list_connectors');

    expect(data).toEqual({
      items: [
        {
          id: 'c0c0c0c0-0000-4000-8000-000000000001',
          name: 'Stripe',
          description: 'Payments, invoices and refunds.',
          slug: 'stripe',
          host: 'mcp.stripe.com',
          status: 'UNKNOWN',
          tools: ['list_invoices', 'create_refund'],
          toolCount: 2,
        },
      ],
      total: 1,
      nextOffset: null,
    });
    expect(JSON.stringify(data)).not.toContain('CONNECTOR_TOKEN');
  });

  it('reads the public catalog, which the live API sends as a list', async () => {
    const catalog = Array.from({ length: 3 }, (_, index) =>
      upstreamConnector({ id: `c0c0c0c0-0000-4000-8000-00000000001${index}`, slug: null }),
    );
    const fake = new FakeWassist().on('GET', '/api/v1/integrations/connectors/public/', catalog);
    session = await connectTools(fake);
    const { data } = await session.call('wassist_list_connectors', { scope: 'catalog', limit: 2 });

    expect(data.items).toHaveLength(2);
    expect(data.items[0].slug).toBeNull();
    expect(data).toMatchObject({ total: 3, nextOffset: 2 });
  });

  it('caps the tool names it returns and still reports the full count', async () => {
    const knownTools = Array.from({ length: 150 }, (_, index) => ({ name: `tool_${index}` }));
    const fake = new FakeWassist().on('GET', '/api/v1/integrations/connectors/', [
      upstreamConnector({ knownTools }),
    ]);
    session = await connectTools(fake);
    const { data } = await session.call('wassist_list_connectors');

    expect(data.items[0].tools).toHaveLength(100);
    expect(data.items[0].toolCount).toBe(150);
  });
});
