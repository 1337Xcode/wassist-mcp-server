import { afterEach, describe, expect, it } from 'vitest';
import { FakeWassist, json } from '../helpers/fake-wassist.js';
import { AGENT_ID, upstreamPhoneNumber } from '../helpers/fixtures.js';
import { connectTools, type Session } from '../helpers/mcp.js';

// The client under test, closed after each test.
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

// The shared sandbox number: no business account, no agent and no routing.
const sandbox = upstreamPhoneNumber({
  id: '33333333-3333-4333-8333-333333333333',
  number: '15550001111',
  whatsappBusinessAccount: null,
  activeAgent: null,
  defaultRouting: null,
  isSandbox: true,
});

describe('wassist_list_phone_numbers', () => {
  it('pages a bare-array response locally and reports the total', async () => {
    const fake = new FakeWassist().on('GET', '/api/v1/phone-numbers/', [
      upstreamPhoneNumber(),
      sandbox,
    ]);
    session = await connectTools(fake);
    const { data } = await session.call('wassist_list_phone_numbers', { limit: 1 });

    expect(fake.requests[0]?.url.search).toBe('');
    expect(data).toEqual({
      items: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          number: '447700900100',
          isSandbox: false,
          defaultRouting: 'agent',
          activeAgent: { id: AGENT_ID, name: 'Support Bot' },
          defaultWebhook: null,
          whatsappBusinessAccount: { id: '6b86b273-ff34-4fce-8d4f-2e1d6c5f4a10', name: 'Acme Ltd' },
        },
      ],
      total: 2,
      nextOffset: 1,
    });
  });

  it('returns the second page and no further offset', async () => {
    const fake = new FakeWassist().on('GET', '/api/v1/phone-numbers/', [
      upstreamPhoneNumber(),
      sandbox,
    ]);
    session = await connectTools(fake);
    const { data } = await session.call('wassist_list_phone_numbers', { limit: 1, offset: 1 });

    expect(data.items.map((item: { number: string }) => item.number)).toEqual(['15550001111']);
    expect(data.items[0].isSandbox).toBe(true);
    expect(data.nextOffset).toBeNull();
  });
});

describe('wassist_connect_agent_to_number', () => {
  it('posts to the number without its leading plus and passes applyToExisting through', async () => {
    const fake = new FakeWassist().on(
      'POST',
      '/api/v1/phone-numbers/447700900100/connect-agent/',
      upstreamPhoneNumber(),
    );
    session = await connectTools(fake);
    const { data } = await session.call('wassist_connect_agent_to_number', {
      number: '+447700900100',
      agentId: AGENT_ID,
      applyToExisting: false,
    });

    expect(fake.requests[0]?.body).toEqual({ agentId: AGENT_ID, applyToExisting: false });
    expect(data.defaultRouting).toBe('agent');
    expect(data.activeAgent).toEqual({ id: AGENT_ID, name: 'Support Bot' });
  });

  it('makes the caller choose applyToExisting instead of relying on an upstream default', async () => {
    const fake = new FakeWassist();
    session = await connectTools(fake);
    const { isError } = await session.call('wassist_connect_agent_to_number', {
      number: '+447700900100',
      agentId: AGENT_ID,
    });

    expect(isError).toBe(true);
    expect(fake.requests).toHaveLength(0);
  });

  it('explains that API keys cannot route the sandbox number', async () => {
    const fake = new FakeWassist().on(
      'POST',
      '/api/v1/phone-numbers/15550001111/connect-agent/',
      json({ error: 'Sandbox routing requires a signed-in user.' }, 400),
    );
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_connect_agent_to_number', {
      number: '15550001111',
      agentId: AGENT_ID,
      applyToExisting: true,
    });

    expect(isError).toBe(true);
    expect(data.error.message).toBe(
      'Sandbox routing requires a signed-in user. This is the shared sandbox number, and API keys cannot route it, so do not retry. Give the user the agent connectUrl from wassist_get_agent to open in WhatsApp, or have them set routing in the dashboard under Numbers, Sandbox numbers.',
    );
  });

  it('rejects a phone number that is not E.164 without calling Wassist', async () => {
    const fake = new FakeWassist();
    session = await connectTools(fake);
    const { isError } = await session.call('wassist_connect_agent_to_number', {
      number: '../agents',
      agentId: AGENT_ID,
      applyToExisting: true,
    });

    expect(isError).toBe(true);
    expect(fake.requests).toHaveLength(0);
  });
});

describe('wassist_clear_number_routing', () => {
  it('clears routing and reports the number with no agent', async () => {
    const fake = new FakeWassist().on(
      'POST',
      '/api/v1/phone-numbers/447700900100/unsubscribe/',
      upstreamPhoneNumber({ activeAgent: null, defaultRouting: null }),
    );
    session = await connectTools(fake);
    const { data } = await session.call('wassist_clear_number_routing', {
      number: '447700900100',
      applyToExisting: true,
    });

    expect(fake.requests[0]?.body).toEqual({ applyToExisting: true });
    expect(data.defaultRouting).toBeNull();
    expect(data.activeAgent).toBeNull();
  });
});
