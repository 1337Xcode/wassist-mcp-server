import { afterEach, describe, expect, it } from 'vitest';
import { FakeWassist, json, TEST_API_KEY } from '../helpers/fake-wassist.js';
import {
  AGENT_CONNECTOR_ID,
  AGENT_ID,
  API_TOOL_ID,
  BILLING_AGENT_ID,
  CONNECTOR_ID,
  HANDOFF_ID,
  TOOL_SECRET,
  TRIGGER_SECRET,
  upstreamAgent,
  WEBSITE_TOOL_ID,
} from '../helpers/fixtures.js';
import { connectTools, type Session } from '../helpers/mcp.js';

// The client under test, closed after each test.
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

/** What wassist_get_agent must return for the fixture agent, with no credentials in it. */
const detail = {
  id: AGENT_ID,
  name: 'Support Bot',
  description: 'Answers order questions',
  llmModel: 'openai/gpt-4.1-mini',
  phoneNumbers: ['447700900100'],
  createdAt: '2026-09-01T10:00:00.000000Z',
  systemPrompt: 'You are the support assistant.',
  firstMessage: 'Hi! How can I help?',
  icebreakers: ['Track my order', 'Returns'],
  reasoningEffort: null,
  capabilities: {
    apiTools: [
      {
        id: API_TOOL_ID,
        name: 'check_order_status',
        description: 'Looks up an order',
        active: true,
      },
    ],
    websiteTools: [
      { id: WEBSITE_TOOL_ID, url: 'https://acme.example', prompt: 'Read the site', active: true },
    ],
    handoffs: [
      {
        id: HANDOFF_ID,
        agentId: BILLING_AGENT_ID,
        agentName: 'Billing Bot',
        description: 'Billing questions',
        active: true,
      },
    ],
    connectors: [
      {
        id: AGENT_CONNECTOR_ID,
        connectorId: CONNECTOR_ID,
        connectorName: 'Stripe',
        tools: ['list_invoices'],
      },
    ],
    documents: [{ id: 'd1', name: 'returns.pdf', status: 'ready' }],
    imageGenerateTools: 0,
  },
  totalMessages: 42,
  totalSessions: 7,
  connectUrl: 'https://wa.me/447700900100',
};

describe('wassist_list_agents', () => {
  it('returns summaries and the next offset from the upstream envelope', async () => {
    const fake = new FakeWassist().on(
      'GET',
      '/api/v1/agents/',
      json({ count: 3, next: 'https://x/?offset=1', previous: null, results: [upstreamAgent()] }),
    );
    session = await connectTools(fake);
    const { data } = await session.call('wassist_list_agents', { limit: 1 });

    expect(fake.requests[0]?.url.search).toBe('?limit=1&offset=0');
    expect(fake.requests[0]?.headers.get('x-api-key')).toBe(TEST_API_KEY);
    expect(data).toEqual({
      items: [
        {
          id: AGENT_ID,
          name: 'Support Bot',
          description: 'Answers order questions',
          llmModel: 'openai/gpt-4.1-mini',
          phoneNumbers: ['447700900100'],
          createdAt: '2026-09-01T10:00:00.000000Z',
        },
      ],
      total: 3,
      nextOffset: 1,
    });
  });

  it('reports no next page on the last page', async () => {
    const fake = new FakeWassist().on('GET', '/api/v1/agents/', {
      count: 1,
      next: null,
      previous: null,
      results: [upstreamAgent()],
    });
    session = await connectTools(fake);
    const { data } = await session.call('wassist_list_agents');

    expect(data.nextOffset).toBeNull();
  });

  it('rejects a limit above the maximum before calling Wassist', async () => {
    const fake = new FakeWassist();
    session = await connectTools(fake);
    const { isError } = await session.call('wassist_list_agents', { limit: 500 });

    expect(isError).toBe(true);
    expect(fake.requests).toHaveLength(0);
  });
});

describe('wassist_get_agent', () => {
  it('returns the configuration without any tool or trigger credentials', async () => {
    const fake = new FakeWassist().on('GET', `/api/v1/agents/${AGENT_ID}/`, upstreamAgent());
    session = await connectTools(fake);
    const result = await session.client.callTool({
      name: 'wassist_get_agent',
      arguments: { agentId: AGENT_ID },
    });

    expect(result.structuredContent).toEqual(detail);
    const everything = JSON.stringify(result);
    expect(everything).not.toContain(TOOL_SECRET);
    expect(everything).not.toContain(TRIGGER_SECRET);
    expect(everything).not.toContain('apiSchema');
  });

  it('rejects an ID that is not a UUID without calling Wassist', async () => {
    const fake = new FakeWassist();
    session = await connectTools(fake);
    const { isError } = await session.call('wassist_get_agent', {
      agentId: '../../whatsapp-accounts',
    });

    expect(isError).toBe(true);
    expect(fake.requests).toHaveLength(0);
  });

  it('turns a missing agent into a not_found tool error', async () => {
    const fake = new FakeWassist().on(
      'GET',
      `/api/v1/agents/${AGENT_ID}/`,
      json({ detail: 'Not found.' }, 404),
    );
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_get_agent', { agentId: AGENT_ID });

    expect(isError).toBe(true);
    expect(data.error).toEqual({
      code: 'not_found',
      message: 'Wassist could not find that resource. Check the ID with the matching list tool.',
      status: 404,
    });
  });
});

describe('wassist_create_agent', () => {
  it('creates an agent from a name only', async () => {
    const fake = new FakeWassist().on(
      'POST',
      '/api/v1/agents/',
      json(upstreamAgent({ name: 'Sales Bot' }), 201),
    );
    session = await connectTools(fake);
    const { data } = await session.call('wassist_create_agent', { name: 'Sales Bot' });

    expect(fake.requests[0]?.body).toEqual({ name: 'Sales Bot' });
    expect(data.name).toBe('Sales Bot');
  });
});

describe('wassist_update_agent', () => {
  it('sends only the fields that were passed and never touches tool collections', async () => {
    const fake = new FakeWassist().on(
      'PATCH',
      `/api/v1/agents/${AGENT_ID}/`,
      upstreamAgent({ systemPrompt: 'New prompt' }),
    );
    session = await connectTools(fake);
    const { data } = await session.call('wassist_update_agent', {
      agentId: AGENT_ID,
      systemPrompt: 'New prompt',
    });

    expect(fake.requests[0]?.body).toEqual({ systemPrompt: 'New prompt' });
    expect(data.systemPrompt).toBe('New prompt');
    expect(data.capabilities).toEqual(detail.capabilities);
  });

  it('requires at least one field to change', async () => {
    const fake = new FakeWassist();
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_update_agent', { agentId: AGENT_ID });

    expect(isError).toBe(true);
    expect(data.message).toContain('Pass at least one field to change.');
    expect(fake.requests).toHaveLength(0);
  });

  it('refuses fields that would replace tool collections', async () => {
    const fake = new FakeWassist();
    session = await connectTools(fake);
    const { isError } = await session.call('wassist_update_agent', {
      agentId: AGENT_ID,
      tools: [],
    });

    expect(isError).toBe(true);
    expect(fake.requests).toHaveLength(0);
  });

  it('reports an upstream validation message and does not retry the write', async () => {
    const fake = new FakeWassist().on(
      'PATCH',
      `/api/v1/agents/${AGENT_ID}/`,
      json({ llmModel: ['A paid plan is required.'] }, 400),
    );
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_update_agent', {
      agentId: AGENT_ID,
      llmModel: 'openai/gpt-5.4',
    });

    expect(isError).toBe(true);
    expect(data.error).toEqual({
      code: 'invalid_request',
      message: 'llmModel: A paid plan is required.',
      status: 400,
    });
    expect(fake.requests).toHaveLength(1);
  });
});
