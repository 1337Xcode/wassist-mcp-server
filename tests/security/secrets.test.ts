import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/logger.js';
import { FakeWassist, json, TEST_API_KEY } from '../helpers/fake-wassist.js';
import { AGENT_ID, CONVERSATION_ID, upstreamAgent } from '../helpers/fixtures.js';
import { connectTools, type Session } from '../helpers/mcp.js';

// The client under test, closed after each test.
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe('credentials and customer data', () => {
  it('has no tool argument that could carry a credential', async () => {
    session = await connectTools(new FakeWassist());
    const { tools } = await session.client.listTools();
    const names = tools.flatMap((tool) =>
      Object.keys((tool.inputSchema.properties ?? {}) as object),
    );

    expect(
      names.filter((name) => /key|token|secret|password|authorization|header/i.test(name)),
    ).toEqual([]);
  });

  it('never puts the API key in a tool result, even when Wassist echoes it back', async () => {
    const fake = new FakeWassist().on(
      'GET',
      `/api/v1/agents/${AGENT_ID}/`,
      json({ detail: `Invalid credentials ${TEST_API_KEY}` }, 400),
    );
    session = await connectTools(fake);
    const result = await session.client.callTool({
      name: 'wassist_get_agent',
      arguments: { agentId: AGENT_ID },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(TEST_API_KEY);
    expect(JSON.stringify(result)).toContain('[redacted]');
  });

  it('logs a failed call without the arguments, the customer text or the key', async () => {
    const fake = new FakeWassist().on(
      'POST',
      `/api/v1/conversations/${CONVERSATION_ID}/messages/`,
      json({ error: 'nope' }, 400),
    );
    session = await connectTools(fake);
    await session.call('wassist_send_text_message', {
      conversationId: CONVERSATION_ID,
      text: 'private customer reply 555-0100',
    });

    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls);
    expect(logged).toContain('wassist_send_text_message');
    expect(logged).not.toContain('private customer reply');
    expect(logged).not.toContain(TEST_API_KEY);
  });

  it('hides the details of a transport failure behind a generic message', async () => {
    const fake = new FakeWassist().on('GET', `/api/v1/agents/${AGENT_ID}/`, () => {
      throw new Error('database password is hunter2');
    });
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_get_agent', { agentId: AGENT_ID });

    expect(isError).toBe(true);
    expect(data.error.code).toBe('network_error');
    expect(JSON.stringify(data)).not.toContain('hunter2');
  });

  it('reports a malformed upstream agent as an invalid response instead of passing it on', async () => {
    const fake = new FakeWassist().on(
      'GET',
      `/api/v1/agents/${AGENT_ID}/`,
      upstreamAgent({ id: 42 }),
    );
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_get_agent', { agentId: AGENT_ID });

    expect(isError).toBe(true);
    expect(data.error).toMatchObject({
      code: 'invalid_response',
      message: 'Wassist returned data in an unexpected shape at id.',
    });
  });
});
