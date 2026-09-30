import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isReadOnly } from '../../src/mcp/tool.js';
import { allTools } from '../../src/tools.js';

/**
 * Talks to the real Wassist API with the key in WASSIST_API_KEY. The server is started in read-only mode,
 * so this suite cannot send a message or change anything, and it only prints counts, never customer data.
 * Run it with `npm run test:live`.
 */
const apiKey = process.env.WASSIST_API_KEY;
// The built server that this suite launches over stdio.
const entry = fileURLToPath(new URL('../../dist/bin/stdio.js', import.meta.url));

/** The shape of every list tool's result, as far as this suite reads it. */
interface Page {
  items: { id: string }[];
  total: number | null;
  nextOffset: number | null;
}

describe.skipIf(!apiKey)('live read-only check against the Wassist API', () => {
  let client: Client;

  const read = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError, `${name} should succeed`).not.toBe(true);
    return result.structuredContent as unknown as Page;
  };

  beforeAll(async () => {
    const env = {
      ...process.env,
      WASSIST_API_KEY: apiKey ?? '',
      WASSIST_READ_ONLY: 'true',
    } as Record<string, string>;
    client = new Client({ name: 'live-check', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [entry], env, stderr: 'ignore' }),
    );
  });
  afterAll(() => client.close());

  it('exposes only read tools', async () => {
    const { tools } = await client.listTools();

    expect(tools.length).toBe(allTools.filter(isReadOnly).length);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  });

  it('lists every resource type and reads one item of each that exists', async () => {
    const agents = await read('wassist_list_agents', { limit: 5 });
    const numbers = await read('wassist_list_phone_numbers');
    const conversations = await read('wassist_list_conversations', { limit: 5 });
    const templates = await read('wassist_list_templates');
    const accounts = await read('wassist_list_whatsapp_accounts');

    // Every listed agent is read in full, which checks the capability view against real agents.
    for (const agent of agents.items) await read('wassist_get_agent', { agentId: agent.id });
    const connected = await read('wassist_list_connectors');
    const catalog = await read('wassist_list_connectors', { scope: 'catalog', limit: 50 });
    const firstAgent = agents.items[0];
    const personas = firstAgent
      ? await read('wassist_list_test_personas', { agentId: firstAgent.id })
      : { items: [] };
    const firstConversation = conversations.items[0];
    let messageCount = 0;
    if (firstConversation) {
      await read('wassist_get_conversation', { conversationId: firstConversation.id });
      messageCount = (
        await read('wassist_list_messages', { conversationId: firstConversation.id, limit: 5 })
      ).items.length;
    }

    console.info(
      `live counts: agents=${agents.items.length} numbers=${numbers.items.length} conversations=${conversations.items.length} ` +
        `templates=${templates.items.length} accounts=${accounts.items.length} messagesRead=${messageCount} ` +
        `connectors=${connected.items.length} catalog=${catalog.items.length} personas=${personas.items.length}`,
    );
    expect(numbers.items.length).toBeGreaterThanOrEqual(0);
  });
});
