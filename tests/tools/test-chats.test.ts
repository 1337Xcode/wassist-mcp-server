import { afterEach, describe, expect, it } from 'vitest';
import { FakeWassist, json, type Responder } from '../helpers/fake-wassist.js';
import { AGENT_ID } from '../helpers/fixtures.js';
import { connectTools, type Session } from '../helpers/mcp.js';

// The client under test, closed after each test.
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

// The id of the chat these tests talk to, and the two endpoints they use.
const CHAT_ID = '7d1b7f0e-5a54-4d0a-8f0b-2f9a3b2c1d00';
const MESSAGES_PATH = `/api/v1/simulations/${CHAT_ID}/messages/`;

/** A message as the live API returns it. */
const message = (id: string, role: 'user' | 'assistant', body: string) => ({
  id,
  role,
  messageType: 'text',
  content: { body },
  createdAt: '2026-09-29T03:00:00Z',
});

/** A chat as the live API returns it when created, or after a message is sent. */
const chat = (messages: unknown[] = [], isProcessing = false) => ({
  id: CHAT_ID,
  agentId: AGENT_ID,
  agentName: 'Friendly Chatbot',
  title: 'Test chat',
  messages,
  toolExecutions: [],
  createdAt: '2026-09-29T03:00:00Z',
  isProcessing,
  supportRouting: null,
});

/** Answers each read of the messages with the next list, and keeps returning the last one. */
function reads(...lists: unknown[][]): Responder {
  let call = 0;
  return () => json(lists[Math.min(call++, lists.length - 1)]);
}

describe('wassist_start_test_chat', () => {
  it('starts a chat for the agent and sends nothing to WhatsApp', async () => {
    const fake = new FakeWassist().on('POST', '/api/v1/simulations/', json(chat(), 201));
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_start_test_chat', { agentId: AGENT_ID });

    expect(isError).toBe(false);
    expect(data).toEqual({
      id: CHAT_ID,
      agentId: AGENT_ID,
      agentName: 'Friendly Chatbot',
      title: 'Test chat',
      createdAt: '2026-09-29T03:00:00Z',
    });
    expect(fake.requests.map((request) => [request.method, request.url.pathname])).toEqual([
      ['POST', '/api/v1/simulations/'],
    ]);
    expect(fake.requests[0]?.body).toEqual({ agent: AGENT_ID });
  });

  it('rejects an agent id that is not a UUID without calling Wassist', async () => {
    const fake = new FakeWassist();
    session = await connectTools(fake);
    const { isError } = await session.call('wassist_start_test_chat', { agentId: 'not-an-id' });

    expect(isError).toBe(true);
    expect(fake.requests).toHaveLength(0);
  });
});

describe('wassist_send_test_message', () => {
  const user = message('m1', 'user', 'Hello');
  const answer = message('m2', 'assistant', 'Hello! How can I help you today?');

  it('sends the text once and returns the answer when it has stopped growing', async () => {
    const fake = new FakeWassist()
      .on('POST', MESSAGES_PATH, json(chat([user], true)))
      .on('GET', MESSAGES_PATH, reads([], [user], [user, answer], [user, answer]));
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_send_test_message', {
      testChatId: CHAT_ID,
      text: 'Hello',
    });

    expect(isError).toBe(false);
    expect(data).toEqual({
      testChatId: CHAT_ID,
      replies: [
        {
          id: 'm2',
          role: 'assistant',
          type: 'text',
          text: 'Hello! How can I help you today?',
          createdAt: '2026-09-29T03:00:00Z',
        },
      ],
      stillWorking: false,
    });
    const posts = fake.requests.filter((request) => request.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ messageType: 'text', content: { body: 'Hello' } });
  });

  it('returns only the new answers, not the ones already in the chat', async () => {
    const earlier = [message('m0', 'user', 'Hi'), message('a0', 'assistant', 'Hi there')];
    const fake = new FakeWassist()
      .on('POST', MESSAGES_PATH, json(chat([user], true)))
      .on(
        'GET',
        MESSAGES_PATH,
        reads(earlier, [...earlier, user, answer], [...earlier, user, answer]),
      );
    session = await connectTools(fake);
    const { data } = await session.call('wassist_send_test_message', {
      testChatId: CHAT_ID,
      text: 'Hello',
    });

    expect(data.replies.map((reply: { id: string }) => reply.id)).toEqual(['m2']);
  });

  it('says the agent is still working when no answer arrives in time, and never resends', async () => {
    const fake = new FakeWassist()
      .on('POST', MESSAGES_PATH, json(chat([user], true)))
      .on('GET', MESSAGES_PATH, reads([], [user]));
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_send_test_message', {
      testChatId: CHAT_ID,
      text: 'Hello',
    });

    expect(isError).toBe(false);
    expect(data).toEqual({ testChatId: CHAT_ID, replies: [], stillWorking: true });
    expect(fake.requests.filter((request) => request.method === 'POST')).toHaveLength(1);
  });

  it('does not resend the message when Wassist fails, and says the outcome is unknown', async () => {
    const fake = new FakeWassist()
      .on('POST', MESSAGES_PATH, json({ detail: 'boom' }, 503))
      .on('GET', MESSAGES_PATH, json([]));
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_send_test_message', {
      testChatId: CHAT_ID,
      text: 'Hello',
    });

    expect(isError).toBe(true);
    expect(data.error.outcomeUnknown).toBe(true);
    expect(fake.requests.filter((request) => request.method === 'POST')).toHaveLength(1);
  });

  it.each([
    ['an empty message', { testChatId: CHAT_ID, text: '' }],
    ['a chat id that is not a UUID', { testChatId: 'nope', text: 'Hello' }],
    ['an unknown field', { testChatId: CHAT_ID, text: 'Hello', extra: true }],
  ])('rejects %s without calling Wassist', async (_label, args) => {
    const fake = new FakeWassist();
    session = await connectTools(fake);
    const { isError } = await session.call('wassist_send_test_message', args);

    expect(isError).toBe(true);
    expect(fake.requests).toHaveLength(0);
  });
});

describe('wassist_read_test_chat', () => {
  it('returns the latest messages with the total', async () => {
    const all = Array.from({ length: 60 }, (_, index) =>
      message(`m${index}`, index % 2 ? 'assistant' : 'user', `text ${index}`),
    );
    const fake = new FakeWassist().on('GET', MESSAGES_PATH, json(all));
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_read_test_chat', { testChatId: CHAT_ID });

    expect(isError).toBe(false);
    expect(data.total).toBe(60);
    expect(data.messages).toHaveLength(50);
    expect(data.messages[0].id).toBe('m10');
  });

  it('accepts the messages inside a chat object as well as a bare list', async () => {
    const fake = new FakeWassist().on(
      'GET',
      MESSAGES_PATH,
      json(chat([message('m1', 'user', 'Hello')])),
    );
    session = await connectTools(fake);
    const { data } = await session.call('wassist_read_test_chat', { testChatId: CHAT_ID });

    expect(data.messages.map((entry: { text: string }) => entry.text)).toEqual(['Hello']);
  });

  it('reports an unknown chat as not found', async () => {
    const fake = new FakeWassist().on('GET', MESSAGES_PATH, json({ detail: 'Not found.' }, 404));
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_read_test_chat', { testChatId: CHAT_ID });

    expect(isError).toBe(true);
    expect(data.error.code).toBe('not_found');
  });
});
