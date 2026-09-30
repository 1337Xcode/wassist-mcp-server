// Fixed ids, so assertions can name them.
export const AGENT_ID = 'd023c53d-038c-42f2-aaff-b9f3508720b9';
export const CONVERSATION_ID = '233afbf2-8c9e-43bd-ad25-7342243fb0ec';
export const TEMPLATE_ID = '8f14e45f-ceea-467a-9575-1b1e7b3e5a90';
export const ACCOUNT_ID = '6b86b273-ff34-4fce-8d4f-2e1d6c5f4a10';

// Ids of the entries on the fixture agent's capability lists, and of the agent it hands over to.
export const API_TOOL_ID = 'a1a1a1a1-0000-4000-8000-000000000001';
export const WEBSITE_TOOL_ID = 'a1a1a1a1-0000-4000-8000-000000000002';
export const HANDOFF_ID = 'a1a1a1a1-0000-4000-8000-000000000003';
export const AGENT_CONNECTOR_ID = 'a1a1a1a1-0000-4000-8000-000000000004';
export const CONNECTOR_ID = 'c0c0c0c0-0000-4000-8000-000000000001';
export const BILLING_AGENT_ID = 'b2b2b2b2-0000-4000-8000-000000000001';

// Credentials the upstream agent carries. No tool result may ever contain them.
export const TOOL_SECRET = 'Bearer sk_live_TOOL_SECRET_VALUE';
export const TRIGGER_SECRET = 'whsec_TRIGGER_SECRET_VALUE';

/** Upstream agent as the live API returns it, including credentials that must never reach the model. */
export function upstreamAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: AGENT_ID,
    name: 'Support Bot',
    description: 'Answers order questions',
    systemPrompt: 'You are the support assistant.',
    firstMessage: 'Hi! How can I help?',
    profilePicture: null,
    icebreakers: ['Track my order', 'Returns'],
    llmModel: 'openai/gpt-4.1-mini',
    reasoningEffort: null,
    tools: [
      {
        id: API_TOOL_ID,
        name: 'check_order_status',
        description: 'Looks up an order',
        active: true,
        creditCost: 0,
        apiSchema: {
          url: 'https://api.acme.example/orders/{order_id}',
          method: 'GET',
          request_headers: { Authorization: { input: { type: 'value', value: TOOL_SECRET } } },
        },
      },
    ],
    documents: [{ id: 'd1', name: 'returns.pdf', status: 'ready' }],
    memoryKeys: [],
    wakeUpConfigs: [],
    outboundTriggers: [
      { id: 'o1', url: 'https://hooks.example/x', secret: TRIGGER_SECRET, enabled: true },
    ],
    websiteTools: [
      { id: WEBSITE_TOOL_ID, url: 'https://acme.example', prompt: 'Read the site', active: true },
    ],
    imageGenerateTools: [],
    handoffTools: [
      {
        id: HANDOFF_ID,
        parentAgentId: AGENT_ID,
        childAgentId: BILLING_AGENT_ID,
        childAgentName: 'Billing Bot',
        description: 'Billing questions',
        active: true,
      },
    ],
    mcpConfigs: [
      {
        id: AGENT_CONNECTOR_ID,
        connectorId: CONNECTOR_ID,
        connectorName: 'Stripe',
        toolWhitelist: ['list_invoices'],
      },
    ],
    supportTools: [],
    shopifyStores: [],
    appInstallations: [],
    paywallConfig: null,
    adConfig: null,
    creditSettings: null,
    voiceCallConfig: null,
    organization: { id: 'org-1', name: 'Acme', isPersonal: false },
    phoneNumbers: [{ phoneNumber: '447700900100', whatsappPhoneNumberId: '1001', wabaId: 'w1' }],
    totalMessages: 42,
    totalSessions: 7,
    connectUrl: 'https://wa.me/447700900100',
    createdAt: '2026-09-01T10:00:00.000000Z',
    ...overrides,
  };
}

/** A phone number as the live API returns it. */
export function upstreamPhoneNumber(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    number: '447700900100',
    whatsappPhoneNumberId: '1001',
    whatsappBusinessAccount: { id: ACCOUNT_ID, name: 'Acme Ltd', waId: '555' },
    activeAgent: { id: AGENT_ID, name: 'Support Bot', icebreakers: [] },
    defaultRouting: 'agent',
    defaultWebhook: null,
    isSandbox: false,
    analyticsEnabled: true,
    ...overrides,
  };
}

/** A conversation as the live API returns it, with a message from the customer last. */
export function upstreamConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION_ID,
    contact: { id: 'c-1', phoneNumber: '447700900200', name: 'Alex' },
    activeAgent: { id: AGENT_ID, name: 'Support Bot' },
    whatsappNumber: { id: 'n-1', number: '447700900100', isSandbox: false },
    chatWindowRemainingTime: 3600,
    lastMessage: {
      type: 'text',
      body: 'Where is my order?',
      createdAt: '2026-09-29T01:00:00Z',
      role: 'user',
    },
    isHumanTakeover: false,
    active: true,
    routing: 'agent',
    webhookId: null,
    routingOverride: false,
    activeSupportHandoff: null,
    supportHandoffs: [],
    shopifyCustomer: null,
    latestReferral: null,
    needsReview: false,
    reviewReasons: [],
    analyticsEnabled: true,
    ...overrides,
  };
}

/** A message as the live API returns it. The defaults are an agent reply in plain text. */
export function upstreamMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    role: 'assistant',
    type: 'text',
    status: 'read',
    createdAt: '2026-09-29T01:00:05Z',
    replyTo: null,
    source: 'agent',
    supportHandoff: null,
    text: { body: 'Your order ships tomorrow.' },
    image: null,
    cta: null,
    listSelection: null,
    template: null,
    unified: null,
    quickReply: null,
    toolExecutions: [],
    referral: null,
    intentId: null,
    ...overrides,
  };
}

/** A template as the live API returns it, before any review status exists. */
export function upstreamTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    name: 'order_update',
    category: 'UTILITY',
    language: 'en',
    parameterFormat: 'POSITIONAL',
    components: [{ type: 'BODY', text: 'Hi {{1}}, your order {{2}} shipped.' }],
    libraryKey: null,
    accountLinks: [],
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
    ...overrides,
  };
}
