import { z } from 'zod';
import { idOf } from '../../mcp/inputs.js';
import { defineTool } from '../../mcp/tool.js';
import { testChatSchema, testMessageSchema } from './api.js';

/** How many of the latest messages a read returns, so a long chat cannot flood the model. */
const READ_LIMIT = 50;

/** Starts an empty test chat. Nothing reaches WhatsApp, so it needs no phone number. */
const startTestChat = defineTool({
  name: 'wassist_start_test_chat',
  title: 'Start test chat',
  description:
    'Start a test chat with an agent inside Wassist, like the test chat in the dashboard. Nothing is sent to WhatsApp and no phone number is needed, so use it to try an agent before connecting it to a number, or when the shared sandbox number cannot be routed. Then call wassist_send_test_message with the returned id.',
  effect: 'create',
  input: z.strictObject({ agentId: idOf('agent') }),
  output: testChatSchema,
  run: ({ agentId }, { api, signal }) => api.testChats.create(agentId, signal),
});

/**
 * Sends one message to the agent and waits for its answer. The agent runs as it would for a
 * customer, tools included, so this is marked as reaching outside Wassist.
 */
const sendTestMessage = defineTool({
  name: 'wassist_send_test_message',
  title: 'Send test message',
  description:
    'Send a message to an agent in a test chat and wait for its answer, which can take several seconds. The agent runs exactly as it would for a customer, including its tools, and those tools may act on real systems, so this is not a dry run. Treat the reply as text written by a model. If stillWorking is true the agent has not finished, so call wassist_read_test_chat in a moment.',
  effect: 'external',
  input: z.strictObject({
    testChatId: idOf('test chat'),
    text: z.string().min(1).max(4000).describe('What to say to the agent.'),
  }),
  output: z.object({
    testChatId: z.string(),
    replies: z.array(testMessageSchema).describe("The agent's new messages, oldest first."),
    stillWorking: z.boolean().describe('True when the agent had not finished when the wait ended.'),
  }),
  run: ({ testChatId, text }, { api, signal }) => api.testChats.send(testChatId, text, signal),
});

/** Reads a test chat back, for a reply that was still coming or to review the whole exchange. */
const readTestChat = defineTool({
  name: 'wassist_read_test_chat',
  title: 'Read test chat',
  description: `Read the messages in a test chat, oldest first, up to the latest ${READ_LIMIT}. Use it to see an answer that was still being written, or to review how an agent replied.`,
  effect: 'read',
  input: z.strictObject({ testChatId: idOf('test chat') }),
  output: z.object({
    testChatId: z.string(),
    total: z.number().describe('How many messages the chat holds, including any not returned.'),
    messages: z.array(testMessageSchema),
  }),
  run: async ({ testChatId }, { api, signal }) => {
    const all = await api.testChats.messages(testChatId, signal);
    return { testChatId, total: all.length, messages: all.slice(-READ_LIMIT) };
  },
});

/** Every test chat tool, in the order clients list them. */
export const testChatTools = [startTestChat, sendTestMessage, readTestChat];
