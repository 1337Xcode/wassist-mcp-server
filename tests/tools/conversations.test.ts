import { afterEach, describe, expect, it } from 'vitest';
import { FakeWassist, json } from '../helpers/fake-wassist.js';
import {
  AGENT_ID,
  CONVERSATION_ID,
  upstreamConversation,
  upstreamMessage,
} from '../helpers/fixtures.js';
import { connectTools, type Session, type ToolData } from '../helpers/mcp.js';

// The client under test, closed after each test.
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

// The messages endpoint of the fixture conversation.
const messagesPath = `/api/v1/conversations/${CONVERSATION_ID}/messages/`;

describe('wassist_list_conversations', () => {
  it('sends filters upstream and renames the window field to say its unit', async () => {
    const fake = new FakeWassist().on('GET', '/api/v1/conversations/', {
      count: 1,
      next: null,
      previous: null,
      results: [upstreamConversation()],
    });
    session = await connectTools(fake);
    const { data } = await session.call('wassist_list_conversations', {
      status: 'active',
      agentId: AGENT_ID,
      limit: 5,
    });

    const query = fake.requests[0]?.url.searchParams;
    expect(Object.fromEntries(query ?? [])).toEqual({
      limit: '5',
      offset: '0',
      agent: AGENT_ID,
      status: 'active',
      ordering: '-last_message_time',
    });
    expect(data.items).toEqual([
      {
        id: CONVERSATION_ID,
        contact: { name: 'Alex', phoneNumber: '447700900200' },
        whatsappNumber: { number: '447700900100', isSandbox: false },
        activeAgent: { id: AGENT_ID, name: 'Support Bot' },
        chatWindowRemainingSeconds: 3600,
        active: true,
        isHumanTakeover: false,
        routing: 'agent',
        lastMessage: {
          role: 'user',
          type: 'text',
          preview: 'Where is my order?',
          createdAt: '2026-09-29T01:00:00Z',
        },
      },
    ]);
  });

  it('shortens a long last message to a preview', async () => {
    const long = 'a'.repeat(500);
    const conversation = upstreamConversation({
      lastMessage: { type: 'text', body: long, createdAt: '2026-09-29T01:00:00Z', role: 'user' },
    });
    const fake = new FakeWassist().on('GET', '/api/v1/conversations/', {
      count: 1,
      next: null,
      results: [conversation],
    });
    session = await connectTools(fake);
    const { data } = await session.call('wassist_list_conversations');

    expect(data.items[0].lastMessage.preview).toBe(`${'a'.repeat(200)}...`);
  });
});

describe('wassist_get_conversation', () => {
  it('handles a sandbox conversation with no agent, routing or last message', async () => {
    const sandbox = upstreamConversation({
      activeAgent: null,
      routing: null,
      lastMessage: null,
      active: false,
      chatWindowRemainingTime: 0,
    });
    const fake = new FakeWassist().on('GET', `/api/v1/conversations/${CONVERSATION_ID}/`, sandbox);
    session = await connectTools(fake);
    const { data } = await session.call('wassist_get_conversation', {
      conversationId: CONVERSATION_ID,
    });

    expect(data.activeAgent).toBeNull();
    expect(data.lastMessage).toBeNull();
    expect(data.chatWindowRemainingSeconds).toBe(0);
    expect(data.active).toBe(false);
  });
});

describe('wassist_list_messages', () => {
  it('reads a bare-array response, derives text for each message type and drops tool arguments', async () => {
    const messages = [
      upstreamMessage(),
      upstreamMessage({
        id: 'm2',
        role: 'user',
        text: null,
        type: 'quick_reply',
        quickReply: { text: 'Track my order', quickReplyId: 'q1' },
      }),
      upstreamMessage({
        id: 'm3',
        text: null,
        type: 'template',
        template: { templateName: 'order_update' },
      }),
      upstreamMessage({
        id: 'm4',
        toolExecutions: [
          {
            id: 't1',
            toolName: 'check_order_status',
            toolType: 'api',
            args: { order_id: 'SECRET-1' },
            result: { pii: 'x' },
            error: '',
            durationMs: 120,
          },
        ],
      }),
    ];
    const fake = new FakeWassist().on('GET', messagesPath, messages);
    session = await connectTools(fake);
    const result = await session.client.callTool({
      name: 'wassist_list_messages',
      arguments: { conversationId: CONVERSATION_ID, limit: 4 },
    });
    const data = result.structuredContent as {
      items: ToolData[];
      nextOffset: number | null;
      total: number | null;
    };

    expect(fake.requests[0]?.url.search).toBe('?limit=4&offset=0');
    expect(data.items.map((item) => item.text)).toEqual([
      'Your order ships tomorrow.',
      'Track my order',
      '[template: order_update]',
      'Your order ships tomorrow.',
    ]);
    expect(data.items[3].toolExecutions).toEqual([
      { toolName: 'check_order_status', toolType: 'api', error: null, durationMs: 120 },
    ]);
    expect(data.total).toBeNull();
    expect(data.nextOffset).toBe(4);
    expect(JSON.stringify(result)).not.toContain('SECRET-1');
  });

  it('reports the last page when fewer messages than the limit come back', async () => {
    const fake = new FakeWassist().on('GET', messagesPath, [upstreamMessage()]);
    session = await connectTools(fake);
    const { data } = await session.call('wassist_list_messages', {
      conversationId: CONVERSATION_ID,
      limit: 10,
    });

    expect(data.nextOffset).toBeNull();
  });
});

describe('wassist_send_text_message', () => {
  it('sends the text as a unified message and returns the stored message', async () => {
    const stored = upstreamMessage({
      id: 'sent-1',
      text: null,
      unified: { body: 'Your order ships tomorrow.', footer: null, buttons: [], media: [] },
      type: 'unified',
      status: 'sent',
    });
    const fake = new FakeWassist().on('POST', messagesPath, json(stored, 201));
    session = await connectTools(fake);
    const { data } = await session.call('wassist_send_text_message', {
      conversationId: CONVERSATION_ID,
      text: 'Your order ships tomorrow.',
    });

    expect(fake.requests[0]?.body).toEqual({
      type: 'unified',
      unified: { text: 'Your order ships tomorrow.' },
    });
    expect(data).toMatchObject({
      id: 'sent-1',
      role: 'assistant',
      type: 'unified',
      status: 'sent',
      text: 'Your order ships tomorrow.',
    });
  });

  it('reports the closed service window and does not fall back to a template', async () => {
    const fake = new FakeWassist().on(
      'POST',
      messagesPath,
      json({ error: 'Cannot send a session message outside the customer service window.' }, 400),
    );
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_send_text_message', {
      conversationId: CONVERSATION_ID,
      text: 'Hello',
    });

    expect(isError).toBe(true);
    expect(data.error.code).toBe('invalid_request');
    expect(data.error.message).toContain('No template was sent.');
    expect(fake.requests).toHaveLength(1);
  });

  it('never retries a send and says the outcome is unknown after a server error', async () => {
    const fake = new FakeWassist().on('POST', messagesPath, json({}, 503));
    session = await connectTools(fake);
    const { data } = await session.call('wassist_send_text_message', {
      conversationId: CONVERSATION_ID,
      text: 'Hello',
    });

    expect(fake.requests).toHaveLength(1);
    expect(data.error.outcomeUnknown).toBe(true);
    expect(data.error.message).toContain('may or may not have been applied');
  });

  it('rejects an empty message and one over the 1024 character limit', async () => {
    const fake = new FakeWassist();
    session = await connectTools(fake);

    expect(
      (
        await session.call('wassist_send_text_message', {
          conversationId: CONVERSATION_ID,
          text: '',
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await session.call('wassist_send_text_message', {
          conversationId: CONVERSATION_ID,
          text: 'x'.repeat(1025),
        })
      ).isError,
    ).toBe(true);
    expect(fake.requests).toHaveLength(0);
  });
});

describe('wassist_send_template_message', () => {
  it('sends the template name and variables as given', async () => {
    const fake = new FakeWassist().on(
      'POST',
      messagesPath,
      json(
        upstreamMessage({
          text: null,
          type: 'template',
          template: { templateName: 'order_update' },
        }),
        201,
      ),
    );
    session = await connectTools(fake);
    const { data } = await session.call('wassist_send_template_message', {
      conversationId: CONVERSATION_ID,
      templateName: 'order_update',
      variables: { body: ['Alex', '#1234'] },
    });

    expect(fake.requests[0]?.body).toEqual({
      type: 'template',
      template: { name: 'order_update', variables: { body: ['Alex', '#1234'] } },
    });
    expect(data.text).toBe('[template: order_update]');
  });
});
