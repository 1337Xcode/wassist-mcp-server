import { afterEach, describe, expect, it } from 'vitest';
import { FakeWassist, json, type RecordedRequest } from '../helpers/fake-wassist.js';
import {
  AGENT_CONNECTOR_ID,
  AGENT_ID,
  API_TOOL_ID,
  BILLING_AGENT_ID,
  CONNECTOR_ID,
  HANDOFF_ID,
  TOOL_SECRET,
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

// The id Wassist gives any entry this server creates.
const NEW_ID = 'e0e0e0e0-0000-4000-8000-000000000001';
const AGENT_PATH = `/api/v1/agents/${AGENT_ID}/`;

/** Answers a PATCH the way Wassist does: the lists sent replace the agent's, and new entries get an id. */
function applyPatch(request: RecordedRequest): Response {
  const changes = request.body as Record<string, Record<string, unknown>[]>;
  const lists = Object.fromEntries(
    Object.entries(changes).map(([field, entries]) => [
      field,
      entries.map((entry) => ({ id: NEW_ID, active: true, ...entry })),
    ]),
  );
  return json(upstreamAgent(lists));
}

/** A fake that holds the fixture agent and applies PATCHes to it. */
function agentFake(): FakeWassist {
  return new FakeWassist()
    .on('GET', AGENT_PATH, upstreamAgent())
    .on('PATCH', AGENT_PATH, applyPatch);
}

/** The body of the one PATCH a test made. */
function patchBody(fake: FakeWassist): unknown {
  const patches = fake.requests.filter((request) => request.method === 'PATCH');
  expect(patches).toHaveLength(1);
  return patches[0]?.body;
}

describe('wassist_add_api_tool', () => {
  const args = {
    agentId: AGENT_ID,
    name: 'book_table',
    description: 'Use when the customer wants to book a table. Needs a date and party size.',
    method: 'POST',
    url: 'https://api.bistro.example/venues/{venue}/bookings',
    parameters: [
      { name: 'venue', in: 'path', value: 'soho' },
      { name: 'date', in: 'body', description: 'The booking date, YYYY-MM-DD' },
      { name: 'party', in: 'body', type: 'integer', description: 'How many people' },
      { name: 'phone', in: 'body', value: '%PHONE_NUMBER%', required: false },
    ],
  };

  it('keeps the existing tool whole, secret header included, and adds the new one', async () => {
    const fake = agentFake();
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_add_api_tool', args);

    expect(isError).toBe(false);
    expect(patchBody(fake)).toEqual({
      tools: [
        upstreamAgent().tools[0],
        {
          name: 'book_table',
          description: args.description,
          apiSchema: {
            url: 'https://api.bistro.example/venues/{venue}/bookings',
            method: 'POST',
            path_params: { venue: { type: 'string', input: { type: 'value', value: 'soho' } } },
            query_params: { required: [], properties: {} },
            request_headers: {},
            request_body: {
              type: 'object',
              required: ['date', 'party'],
              properties: {
                date: {
                  type: 'string',
                  input: { type: 'description', description: 'The booking date, YYYY-MM-DD' },
                },
                party: {
                  type: 'integer',
                  input: { type: 'description', description: 'How many people' },
                },
                phone: { type: 'string', input: { type: 'value', value: '%PHONE_NUMBER%' } },
              },
            },
          },
        },
      ],
    });
    expect(data.added).toEqual({
      id: NEW_ID,
      name: 'book_table',
      description: args.description,
      active: true,
    });
    expect(data.capabilities.apiTools.map((tool: { id: string }) => tool.id)).toEqual([
      API_TOOL_ID,
      NEW_ID,
    ]);
    expect(JSON.stringify(data)).not.toContain(TOOL_SECRET);
  });

  it.each([
    [
      'a URL placeholder with no path parameter',
      { url: 'https://api.bistro.example/{venue}/{slot}' },
      'Describe the {slot} placeholder as a path parameter.',
    ],
    [
      'a body parameter on a GET',
      {
        method: 'GET',
        url: 'https://api.bistro.example/bookings',
        parameters: [{ name: 'date', in: 'body', description: 'd' }],
      },
      'GET requests have no body.',
    ],
    [
      'a parameter with both a description and a value',
      {
        url: 'https://api.bistro.example/bookings',
        parameters: [{ name: 'date', in: 'body', description: 'd', value: 'v' }],
      },
      'Give either description',
    ],
    ['a plain http URL', { url: 'http://api.bistro.example/bookings', parameters: [] }, 'https'],
  ])('rejects %s before calling Wassist', async (_case, override, message) => {
    const fake = agentFake();
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_add_api_tool', { ...args, ...override });

    expect(isError).toBe(true);
    expect(JSON.stringify(data)).toContain(message);
    expect(fake.requests).toHaveLength(0);
  });

  it('refuses a name the agent already uses, without writing', async () => {
    const fake = agentFake();
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_add_api_tool', {
      ...args,
      name: 'check_order_status',
    });

    expect(isError).toBe(true);
    expect(data.error.code).toBe('conflict');
    expect(data.error.message).toContain(API_TOOL_ID);
    expect(fake.requests.map((request) => request.method)).toEqual(['GET']);
  });

  it('has no input that can carry a header', async () => {
    session = await connectTools(new FakeWassist());
    const { tools } = await session.client.listTools();
    const schema = JSON.stringify(tools.find((tool) => tool.name === 'wassist_add_api_tool'));

    expect(schema).not.toMatch(/"headers?"/i);
  });
});

describe('wassist_add_website_tool', () => {
  it('sends only the website list, with the existing page unchanged', async () => {
    const fake = agentFake();
    session = await connectTools(fake);
    const { data } = await session.call('wassist_add_website_tool', {
      agentId: AGENT_ID,
      url: 'https://acme.example/hours',
      prompt: 'Opening hours',
    });

    expect(patchBody(fake)).toEqual({
      websiteTools: [
        upstreamAgent().websiteTools[0],
        { url: 'https://acme.example/hours', prompt: 'Opening hours' },
      ],
    });
    expect(data.added).toEqual({
      id: NEW_ID,
      url: 'https://acme.example/hours',
      prompt: 'Opening hours',
      active: true,
    });
  });

  it('refuses a page the agent already reads', async () => {
    const fake = agentFake();
    session = await connectTools(fake);
    const { data } = await session.call('wassist_add_website_tool', {
      agentId: AGENT_ID,
      url: 'https://acme.example',
      prompt: 'Again',
    });

    expect(data.error.code).toBe('conflict');
    expect(data.error.message).toContain(WEBSITE_TOOL_ID);
    expect(fake.requests.filter((request) => request.method === 'PATCH')).toHaveLength(0);
  });

  it('reports an entry lost to a concurrent edit and says not to retry', async () => {
    const fake = new FakeWassist()
      .on('GET', AGENT_PATH, upstreamAgent())
      .on('PATCH', AGENT_PATH, upstreamAgent({ websiteTools: [] }));
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_add_website_tool', {
      agentId: AGENT_ID,
      url: 'https://acme.example/hours',
      prompt: 'Opening hours',
    });

    expect(isError).toBe(true);
    expect(data.error.code).toBe('conflict');
    expect(data.error.message).toContain('Do not retry');
  });
});

describe('wassist_add_agent_handoff', () => {
  const SALES_AGENT_ID = 'b2b2b2b2-0000-4000-8000-000000000002';

  it('adds a handoff and keeps the existing one', async () => {
    const fake = agentFake();
    session = await connectTools(fake);
    const { data } = await session.call('wassist_add_agent_handoff', {
      agentId: AGENT_ID,
      targetAgentId: SALES_AGENT_ID,
      description: 'Questions about buying in bulk',
    });

    expect(patchBody(fake)).toEqual({
      handoffTools: [
        upstreamAgent().handoffTools[0],
        { childAgentId: SALES_AGENT_ID, description: 'Questions about buying in bulk' },
      ],
    });
    expect(data.added).toMatchObject({ id: NEW_ID, agentId: SALES_AGENT_ID });
  });

  it('refuses a handoff to the same agent', async () => {
    const fake = agentFake();
    session = await connectTools(fake);
    const { data } = await session.call('wassist_add_agent_handoff', {
      agentId: AGENT_ID,
      targetAgentId: AGENT_ID,
      description: 'Anything',
    });

    expect(data.error.code).toBe('invalid_input');
    expect(fake.requests).toHaveLength(0);
  });

  it('refuses a second handoff to the same agent', async () => {
    const fake = agentFake();
    session = await connectTools(fake);
    const { data } = await session.call('wassist_add_agent_handoff', {
      agentId: AGENT_ID,
      targetAgentId: BILLING_AGENT_ID,
      description: 'Refunds',
    });

    expect(data.error.code).toBe('conflict');
    expect(data.error.message).toContain(HANDOFF_ID);
  });
});

describe('wassist_set_agent_connector', () => {
  const HUBSPOT_ID = 'c0c0c0c0-0000-4000-8000-000000000002';

  /** The organization's connectors: Stripe, already on the agent, and HubSpot, which is not. */
  const connectors = [
    {
      id: CONNECTOR_ID,
      name: 'Stripe',
      description: '',
      url: 'https://mcp.stripe.com/?token=abc',
      status: 'CONNECTED',
      slug: 'stripe',
      logo: null,
      knownTools: [{ name: 'list_invoices' }, { name: 'create_refund' }],
    },
    {
      id: HUBSPOT_ID,
      name: 'HubSpot',
      description: '',
      url: 'https://mcp.hubspot.com/',
      status: 'CONNECTED',
      slug: 'hubspot',
      logo: null,
      knownTools: [{ name: 'search_contacts' }],
    },
  ];

  /** The agent fake, plus the organization's connector list. */
  const fakeWithConnectors = () =>
    agentFake().on('GET', '/api/v1/integrations/connectors/', connectors);

  it('attaches a new connector with the chosen tools', async () => {
    const fake = fakeWithConnectors();
    session = await connectTools(fake);
    const { data } = await session.call('wassist_set_agent_connector', {
      agentId: AGENT_ID,
      connectorId: HUBSPOT_ID,
      tools: ['search_contacts'],
    });

    expect(patchBody(fake)).toEqual({
      mcpConfigs: [
        upstreamAgent().mcpConfigs[0],
        { connectorId: HUBSPOT_ID, toolWhitelist: ['search_contacts'] },
      ],
    });
    expect(data.wasAttached).toBe(false);
    expect(data.connector).toMatchObject({ connectorId: HUBSPOT_ID, tools: ['search_contacts'] });
  });

  it('changes the tool list of a connector already on the agent, keeping its id', async () => {
    const fake = fakeWithConnectors();
    session = await connectTools(fake);
    const { data } = await session.call('wassist_set_agent_connector', {
      agentId: AGENT_ID,
      connectorId: CONNECTOR_ID,
      tools: ['list_invoices', 'create_refund'],
    });

    expect(patchBody(fake)).toEqual({
      mcpConfigs: [
        {
          id: AGENT_CONNECTOR_ID,
          connectorId: CONNECTOR_ID,
          connectorName: 'Stripe',
          toolWhitelist: ['list_invoices', 'create_refund'],
        },
      ],
    });
    expect(data.wasAttached).toBe(true);
  });

  it('refuses a connector the organization has not connected, before reading the agent', async () => {
    const fake = fakeWithConnectors();
    session = await connectTools(fake);
    const { data } = await session.call('wassist_set_agent_connector', {
      agentId: AGENT_ID,
      connectorId: 'c0c0c0c0-0000-4000-8000-000000000099',
      tools: ['anything'],
    });

    expect(data.error.code).toBe('not_found');
    expect(fake.requests.map((request) => request.url.pathname)).toEqual([
      '/api/v1/integrations/connectors/',
    ]);
  });

  it('refuses a tool name the connector does not offer', async () => {
    const fake = fakeWithConnectors();
    session = await connectTools(fake);
    const { data } = await session.call('wassist_set_agent_connector', {
      agentId: AGENT_ID,
      connectorId: HUBSPOT_ID,
      tools: ['delete_everything'],
    });

    expect(data.error).toEqual({
      code: 'invalid_input',
      message:
        'HubSpot has no tool named delete_everything. wassist_list_connectors shows the tools it offers.',
    });
    expect(fake.requests.filter((request) => request.method === 'PATCH')).toHaveLength(0);
  });
});

describe('wassist_remove_agent_capability', () => {
  it('finds the list that holds the id and writes back only that list without it', async () => {
    const fake = agentFake();
    session = await connectTools(fake);
    const { data } = await session.call('wassist_remove_agent_capability', {
      agentId: AGENT_ID,
      capabilityId: HANDOFF_ID,
    });

    expect(patchBody(fake)).toEqual({ handoffTools: [] });
    expect(data.removed).toEqual({ id: HANDOFF_ID, kind: 'handoffs' });
    expect(data.capabilities.handoffs).toEqual([]);
    expect(data.capabilities.apiTools).toHaveLength(1);
  });

  it('reports an id that is not on the agent without writing', async () => {
    const fake = agentFake();
    session = await connectTools(fake);
    const { data } = await session.call('wassist_remove_agent_capability', {
      agentId: AGENT_ID,
      capabilityId: 'f0f0f0f0-0000-4000-8000-000000000000',
    });

    expect(data.error.code).toBe('not_found');
    expect(fake.requests.map((request) => request.method)).toEqual(['GET']);
  });
});
