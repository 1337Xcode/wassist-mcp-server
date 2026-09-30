import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeWassist, json, type RecordedRequest } from '../helpers/fake-wassist.js';
import {
  ACCOUNT_ID,
  AGENT_ID,
  CONNECTOR_ID,
  CONVERSATION_ID,
  HANDOFF_ID,
  TEMPLATE_ID,
  upstreamAgent,
  upstreamConversation,
  upstreamMessage,
  upstreamPhoneNumber,
  upstreamTemplate,
} from '../helpers/fixtures.js';
import { connectTools, type Session } from '../helpers/mcp.js';

/** The operations file that `npm run fixtures:openapi` writes: each method and path with its body fields. */
interface Fixture {
  operations: Record<string, string[]>;
}

// Read from disk, so the test needs no network and no copy of the Wassist docs.
const fixture: Fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/wassist-openapi.json', import.meta.url)), 'utf8'),
);

/** Finds the operation that matches a request and returns the body fields it declares. */
function findOperation(request: RecordedRequest): string[] | undefined {
  for (const [key, bodyProperties] of Object.entries(fixture.operations)) {
    const [method, template = ''] = key.split(' ');
    const pattern = new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`);
    if (method === request.method && pattern.test(request.url.pathname)) return bodyProperties;
  }
  return undefined;
}

// Ids the contract calls use for the test chat, the WhatsApp link, and the test persona and run.
const TEST_CHAT_ID = '7d1b7f0e-5a54-4d0a-8f0b-2f9a3b2c1d00';
const LINK_SESSION_ID = 'b1e8a4c2-0000-4000-8000-000000000001';
const PERSONA_ID = 'd0d0d0d0-0000-4000-8000-000000000001';
const RUN_ID = 'd0d0d0d0-0000-4000-8000-000000000002';

// A persona and a test run, as the OpenAPI file describes them.
const persona = { id: PERSONA_ID, name: 'p', description: 'd', agentId: AGENT_ID, createdAt: '' };
const run = { id: RUN_ID, personaName: 'p', status: 'pending', turnsCompleted: 0, maxTurns: 3 };

/** Answers an agent PATCH with the agent as changed, giving new list entries an id, as Wassist does. */
function patchedAgent(request: RecordedRequest): Response {
  const changes = Object.entries(request.body as Record<string, unknown>).map(([field, value]) => [
    field,
    Array.isArray(value)
      ? value.map((entry, index) => ({
          id: `9f9f9f9f-0000-4000-8000-00000000000${index}`,
          ...entry,
        }))
      : value,
  ]);
  return json(upstreamAgent(Object.fromEntries(changes)));
}

// One answer per endpoint the tools call, so every tool can run once.
const fake = new FakeWassist()
  .on('GET', '/api/v1/agents/', { count: 1, next: null, results: [upstreamAgent()] })
  .on('GET', `/api/v1/agents/${AGENT_ID}/`, upstreamAgent())
  .on('POST', '/api/v1/agents/', upstreamAgent())
  .on('PATCH', `/api/v1/agents/${AGENT_ID}/`, patchedAgent)
  .on('GET', '/api/v1/phone-numbers/', [upstreamPhoneNumber()])
  .on('POST', /\/api\/v1\/phone-numbers\/\d+\/connect-agent\/$/, upstreamPhoneNumber())
  .on('POST', /\/api\/v1\/phone-numbers\/\d+\/unsubscribe\/$/, upstreamPhoneNumber())
  .on('GET', '/api/v1/conversations/', { count: 1, next: null, results: [upstreamConversation()] })
  .on('GET', `/api/v1/conversations/${CONVERSATION_ID}/`, upstreamConversation())
  .on('GET', `/api/v1/conversations/${CONVERSATION_ID}/messages/`, [upstreamMessage()])
  .on('POST', `/api/v1/conversations/${CONVERSATION_ID}/messages/`, upstreamMessage())
  .on('GET', '/api/v1/whatsapp-templates/', [upstreamTemplate()])
  .on('POST', '/api/v1/whatsapp-templates/', upstreamTemplate())
  .on('PATCH', `/api/v1/whatsapp-templates/${TEMPLATE_ID}/`, upstreamTemplate())
  .on('POST', `/api/v1/whatsapp-templates/${TEMPLATE_ID}/publish/`, upstreamTemplate())
  .on('GET', '/api/v1/whatsapp-accounts/', [])
  .on('GET', '/api/v1/integrations/connectors/', [
    { id: CONNECTOR_ID, name: 'Stripe', url: 'https://mcp.stripe.com/', knownTools: [] },
  ])
  .on('GET', '/api/v1/integrations/connectors/public/', [])
  .on('GET', '/api/v1/test-personas/', [persona])
  .on('POST', '/api/v1/test-personas/', persona)
  .on('POST', '/api/v1/test-runs/', run)
  .on('GET', `/api/v1/test-runs/${RUN_ID}/`, run)
  .on('POST', '/api/v1/whatsapp-link-sessions/', {
    id: LINK_SESSION_ID,
    successUrl: 'https://wassist.app/',
    returnUrl: 'https://wassist.app/',
    status: 'PENDING',
    linkUrl: 'https://wassist.app/link/abc123',
  })
  .on('POST', '/api/v1/simulations/', {
    id: TEST_CHAT_ID,
    agentId: AGENT_ID,
    agentName: 'Bot',
    title: 'Test chat',
    messages: [],
    createdAt: '2026-09-29T03:00:00Z',
  })
  .on('POST', `/api/v1/simulations/${TEST_CHAT_ID}/messages/`, {
    id: TEST_CHAT_ID,
    agentId: AGENT_ID,
    agentName: 'Bot',
    title: 'Test chat',
    messages: [],
    createdAt: '2026-09-29T03:00:00Z',
  })
  .on('GET', `/api/v1/simulations/${TEST_CHAT_ID}/messages/`, [
    {
      id: 'm1',
      role: 'assistant',
      messageType: 'text',
      content: { body: 'Hi' },
      createdAt: '2026-09-29T03:00:00Z',
    },
  ]);

// One valid call per tool. Each must succeed and produce exactly one upstream request.
const calls: [string, Record<string, unknown>][] = [
  ['wassist_list_agents', {}],
  ['wassist_get_agent', { agentId: AGENT_ID }],
  ['wassist_create_agent', { name: 'Bot' }],
  [
    'wassist_update_agent',
    {
      agentId: AGENT_ID,
      name: 'Bot',
      description: 'd',
      systemPrompt: 'p',
      firstMessage: 'f',
      icebreakers: ['a'],
      llmModel: 'openai/gpt-4.1',
    },
  ],
  ['wassist_list_phone_numbers', {}],
  [
    'wassist_connect_agent_to_number',
    { number: '+447700900100', agentId: AGENT_ID, applyToExisting: true },
  ],
  ['wassist_clear_number_routing', { number: '+447700900100', applyToExisting: false }],
  ['wassist_list_conversations', { status: 'active', agentId: AGENT_ID }],
  ['wassist_get_conversation', { conversationId: CONVERSATION_ID }],
  ['wassist_list_messages', { conversationId: CONVERSATION_ID }],
  ['wassist_send_text_message', { conversationId: CONVERSATION_ID, text: 'hi' }],
  [
    'wassist_send_template_message',
    { conversationId: CONVERSATION_ID, templateName: 'order_update', variables: { body: ['a'] } },
  ],
  ['wassist_list_templates', {}],
  [
    'wassist_create_template',
    {
      name: 'n',
      category: 'UTILITY',
      language: 'en',
      parameterFormat: 'POSITIONAL',
      components: [{ type: 'BODY', text: 't' }],
    },
  ],
  ['wassist_update_template', { templateId: TEMPLATE_ID, name: 'n2' }],
  ['wassist_publish_template', { templateId: TEMPLATE_ID, accountIds: [ACCOUNT_ID] }],
  ['wassist_list_whatsapp_accounts', {}],
  ['wassist_create_whatsapp_link', {}],
  ['wassist_start_test_chat', { agentId: AGENT_ID }],
  ['wassist_send_test_message', { testChatId: TEST_CHAT_ID, text: 'Hello' }],
  ['wassist_read_test_chat', { testChatId: TEST_CHAT_ID }],
  ['wassist_list_connectors', { scope: 'catalog' }],
  ['wassist_set_agent_connector', { agentId: AGENT_ID, connectorId: CONNECTOR_ID, tools: ['x'] }],
  [
    'wassist_add_api_tool',
    {
      agentId: AGENT_ID,
      name: 'lookup',
      description: 'Looks something up.',
      method: 'GET',
      url: 'https://api.example.com/items/{id}',
      parameters: [{ name: 'id', in: 'path', description: 'The item id' }],
    },
  ],
  ['wassist_add_website_tool', { agentId: AGENT_ID, url: 'https://example.com/x', prompt: 'p' }],
  [
    'wassist_add_agent_handoff',
    {
      agentId: AGENT_ID,
      targetAgentId: '9e9e9e9e-0000-4000-8000-000000000001',
      description: 'Sales',
    },
  ],
  ['wassist_remove_agent_capability', { agentId: AGENT_ID, capabilityId: HANDOFF_ID }],
  ['wassist_list_test_personas', { agentId: AGENT_ID }],
  ['wassist_create_test_persona', { agentId: AGENT_ID, name: 'p', description: 'd' }],
  ['wassist_start_test_run', { personaId: PERSONA_ID, maxTurns: 3 }],
  ['wassist_get_test_run', { testRunId: RUN_ID }],
  ['wassist_guide', {}],
];

// Guides answer from the server itself and never call Wassist.
const LOCAL = new Set(['wassist_guide']);

// Sending a test message reads the chat before and while it waits for the answer, and the
// capability tools read the agent (and the connector list) before they write, so these make
// several requests.
const READS_BACK = new Set([
  'wassist_send_test_message',
  'wassist_set_agent_connector',
  'wassist_add_api_tool',
  'wassist_add_website_tool',
  'wassist_add_agent_handoff',
  'wassist_remove_agent_capability',
]);

// How many requests each tool made when it ran.
const requestsPerTool = new Map<string, number>();

// The client under test, closed after the last test.
let session: Session;
beforeAll(async () => {
  session = await connectTools(fake);
  for (const [name, args] of calls) {
    const before = fake.requests.length;
    const { isError, data } = await session.call(name, args);
    if (isError) throw new Error(`${name} failed: ${JSON.stringify(data)}`);
    requestsPerTool.set(name, fake.requests.length - before);
  }
});
afterAll(() => session.close());

describe('requests match the official Wassist OpenAPI file', () => {
  it('exercised every tool, with one request each apart from those that read back', () => {
    expect(requestsPerTool.size).toBe(calls.length);
    for (const [name, count] of requestsPerTool) {
      if (LOCAL.has(name)) expect(count, name).toBe(0);
      else if (READS_BACK.has(name)) expect(count, name).toBeGreaterThan(1);
      else expect(count, name).toBe(1);
    }
  });

  it('only calls operations the OpenAPI file declares', () => {
    const unknown = fake.requests
      .filter((request) => findOperation(request) === undefined)
      .map((request) => `${request.method} ${request.url.pathname}`);

    expect(unknown).toEqual([]);
  });

  it('only sends body fields the OpenAPI request schema declares, apart from documented gaps', () => {
    // These endpoints are described by a wrong schema in the file, so their bodies come from the docs and the official SDK.
    const documentedGaps = new Set(['connect-agent', 'unsubscribe']);
    // reasoningEffort is in the Wassist create-agent guide and the live API but not in the file's PatchedAgent schema.
    const extraFields = new Set(['reasoningEffort']);

    for (const request of fake.requests) {
      if (
        request.body === undefined ||
        documentedGaps.has(request.url.pathname.split('/').filter(Boolean).pop() ?? '')
      )
        continue;
      const properties = findOperation(request) ?? [];
      const sent = Object.keys(request.body as Record<string, unknown>).filter(
        (field) => !extraFields.has(field),
      );

      expect(properties, `${request.method} ${request.url.pathname}`).toEqual(
        expect.arrayContaining(sent),
      );
    }
  });
});
