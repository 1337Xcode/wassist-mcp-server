import { z } from 'zod';
import { textOrEmpty } from '../../wassist/fields.js';
import { apiPath, type WassistHttp } from '../../wassist/http.js';

// Wassist calls these simulations in its API and shows them as test chats in the dashboard.
// The raw schemas accept what Wassist sends and tolerate missing fields. The exported ones define
// what the tools return.
const rawMessage = z.object({
  id: z.string(),
  role: textOrEmpty,
  messageType: textOrEmpty,
  content: z.record(z.string(), z.unknown()).nullish(),
  createdAt: textOrEmpty,
});

// What creating a chat or sending a message returns: the chat, with the messages so far.
const rawSession = z.object({
  id: z.string(),
  agentId: z.string(),
  agentName: textOrEmpty,
  title: textOrEmpty,
  createdAt: textOrEmpty,
  isProcessing: z.boolean().nullish(),
  messages: z.array(rawMessage).nullish(),
});

// Reading the messages of a chat returns a bare array, though the OpenAPI file promises the chat.
const rawMessages = z.union([
  z.array(rawMessage),
  z.object({ messages: z.array(rawMessage) }).transform((chat) => chat.messages),
]);

/** A test chat, before or after messages are sent to it. */
export const testChatSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  title: z.string(),
  createdAt: z.string(),
});

/** One message in a test chat. The role is `user` for what was sent and `assistant` for the agent. */
export const testMessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  type: z.string(),
  text: z.string().nullable(),
  createdAt: z.string(),
});

export type TestChat = z.infer<typeof testChatSchema>;
export type TestMessage = z.infer<typeof testMessageSchema>;

/** What sending a message returns: the agent's answer, and whether it may still be writing more. */
export interface TestReply {
  testChatId: string;
  replies: TestMessage[];
  stillWorking: boolean;
}

// Wassist answers a test message after the request returns, so the reply is polled for. Polling every
// 1.5 seconds for up to about 30 seconds covers a slow model without holding a request for long.
const POLL_MS = 1500;
const MAX_POLLS = 20;

type RawMessage = z.output<typeof rawMessage>;

/** Keeps the text a reader sees. Other message kinds come through with no text. */
function toMessage(message: RawMessage): TestMessage {
  const body = message.content?.body;
  return {
    id: message.id,
    role: message.role,
    type: message.messageType,
    text: typeof body === 'string' ? body : null,
    createdAt: message.createdAt,
  };
}

/** Operations on /simulations/. */
export function testChatsApi(http: WassistHttp) {
  /** GET /simulations/{id}/messages/. Every message in the chat, oldest first. */
  const messages = async (id: string, signal?: AbortSignal): Promise<TestMessage[]> => {
    const list = await http.request(
      { method: 'GET', path: apiPath`/simulations/${id}/messages/` },
      rawMessages,
      signal,
    );
    return list.map(toMessage);
  };

  return {
    /** POST /simulations/. Starts an empty chat with the agent. Nothing is sent to WhatsApp. */
    async create(agentId: string, signal?: AbortSignal): Promise<TestChat> {
      const chat = await http.request(
        { method: 'POST', path: '/simulations/', body: { agent: agentId } },
        rawSession,
        signal,
      );
      return {
        id: chat.id,
        agentId: chat.agentId,
        agentName: chat.agentName,
        title: chat.title,
        createdAt: chat.createdAt,
      };
    },

    /**
     * POST /simulations/{id}/messages/, then waits for the answer. The write is sent once and never
     * retried. Waiting only reads, and it ends when the reply has stopped growing or time runs out.
     */
    async send(id: string, text: string, signal?: AbortSignal): Promise<TestReply> {
      // Earlier answers stay in the chat, so remember them to tell the new ones apart.
      const earlier = new Set((await messages(id, signal)).map((message) => message.id));
      await http.request(
        {
          method: 'POST',
          path: apiPath`/simulations/${id}/messages/`,
          body: { messageType: 'text', content: { body: text } },
        },
        rawSession,
        signal,
      );

      let replies: TestMessage[] = [];
      for (let poll = 1; poll <= MAX_POLLS; poll++) {
        await http.pause(POLL_MS, signal);
        const latest = (await messages(id, signal)).filter(
          (message) => message.role === 'assistant' && !earlier.has(message.id),
        );
        // Done once there is an answer and a further poll found nothing new.
        if (latest.length > 0 && latest.length === replies.length) {
          return { testChatId: id, replies: latest, stillWorking: false };
        }
        replies = latest;
      }
      return { testChatId: id, replies, stillWorking: true };
    },

    messages,
  };
}
