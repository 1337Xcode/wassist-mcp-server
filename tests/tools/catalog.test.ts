import { afterEach, describe, expect, it } from 'vitest';
import { allTools, selectTools, TOOLSET_NAMES } from '../../src/tools.js';
import { FakeWassist } from '../helpers/fake-wassist.js';
import { connectTools, type Era, type Session } from '../helpers/mcp.js';

// The tools that only read. Read-only mode must expose exactly these.
const READ_TOOLS = [
  'wassist_get_agent',
  'wassist_get_conversation',
  'wassist_get_test_run',
  'wassist_guide',
  'wassist_list_agents',
  'wassist_list_connectors',
  'wassist_list_conversations',
  'wassist_list_messages',
  'wassist_list_phone_numbers',
  'wassist_list_templates',
  'wassist_list_test_personas',
  'wassist_list_whatsapp_accounts',
  'wassist_read_test_chat',
];

// The tools that change something. Read-only mode must hide all of them.
const WRITE_TOOLS = [
  'wassist_add_agent_handoff',
  'wassist_add_api_tool',
  'wassist_add_website_tool',
  'wassist_clear_number_routing',
  'wassist_create_test_persona',
  'wassist_remove_agent_capability',
  'wassist_set_agent_connector',
  'wassist_start_test_run',
  'wassist_create_whatsapp_link',
  'wassist_connect_agent_to_number',
  'wassist_create_agent',
  'wassist_create_template',
  'wassist_publish_template',
  'wassist_send_template_message',
  'wassist_send_test_message',
  'wassist_start_test_chat',
  'wassist_send_text_message',
  'wassist_update_agent',
  'wassist_update_template',
];

// The client under test, closed after each test.
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe.each<Era>(['modern', 'legacy'])('tool catalog over the %s protocol era', (era) => {
  // claude.ai ignores serverInfo.icons, and an open bug there (anthropics/claude-ai-mcp#474) makes
  // it refuse a connection whose initialize response carries the field.
  it('leaves icons out of the server info', async () => {
    session = await connectTools(new FakeWassist(), { era });

    expect(session.client.getServerVersion()?.icons).toBeUndefined();
  });

  it('lists every tool with an input schema and a description', async () => {
    session = await connectTools(new FakeWassist(), { era });
    const { tools } = await session.client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(40);
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('marks read tools read-only and every write tool as not read-only', async () => {
    session = await connectTools(new FakeWassist(), { era });
    const { tools } = await session.client.listTools();
    const readOnly = tools
      .filter((tool) => tool.annotations?.readOnlyHint === true)
      .map((tool) => tool.name);

    expect(readOnly.sort()).toEqual(READ_TOOLS);
  });

  it('exposes only the read tools in read-only mode and refuses to run a write tool', async () => {
    session = await connectTools(new FakeWassist(), { era, readOnly: true });
    const { tools } = await session.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(READ_TOOLS);

    await expect(
      session.call('wassist_send_text_message', {
        conversationId: '5a3f0e2c-7b1d-4c6a-9e8f-1a2b3c4d5e6f',
        text: 'hello',
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe('toolsets', () => {
  it('loads only the chosen toolsets, plus the guide', async () => {
    session = await connectTools(new FakeWassist(), { toolsets: ['testing'] });
    const { tools } = await session.client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'wassist_create_test_persona',
      'wassist_get_test_run',
      'wassist_guide',
      'wassist_list_test_personas',
      'wassist_read_test_chat',
      'wassist_send_test_message',
      'wassist_start_test_chat',
      'wassist_start_test_run',
    ]);
  });

  it('still hides write tools in read-only mode', async () => {
    session = await connectTools(new FakeWassist(), { toolsets: ['testing'], readOnly: true });
    const { tools } = await session.client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'wassist_get_test_run',
      'wassist_guide',
      'wassist_list_test_personas',
      'wassist_read_test_chat',
    ]);
  });

  it('puts every tool except the guide in exactly one toolset', () => {
    const counted = TOOLSET_NAMES.flatMap((name) =>
      selectTools({ readOnly: false, toolsets: [name] }).filter(
        (tool) => tool.name !== 'wassist_guide',
      ),
    );

    expect(counted.map((tool) => tool.name).sort()).toEqual(
      allTools
        .map((tool) => tool.name)
        .filter((name) => name !== 'wassist_guide')
        .sort(),
    );
  });
});
