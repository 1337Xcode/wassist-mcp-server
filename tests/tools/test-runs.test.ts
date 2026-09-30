import { afterEach, describe, expect, it } from 'vitest';
import { FakeWassist, json } from '../helpers/fake-wassist.js';
import { AGENT_ID } from '../helpers/fixtures.js';
import { connectTools, type Session } from '../helpers/mcp.js';

// The client under test, closed after each test.
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

const PERSONA_ID = 'd0d0d0d0-0000-4000-8000-000000000001';
const RUN_ID = 'd0d0d0d0-0000-4000-8000-000000000002';

/** A persona as the OpenAPI file describes it. */
const persona = {
  id: PERSONA_ID,
  name: 'Late order',
  description: 'Wants a refund and gets short with vague answers.',
  agentId: AGENT_ID,
  createdAt: '2026-09-30T10:00:00Z',
};

/** A test run as the OpenAPI file describes it. */
function upstreamRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    personaId: PERSONA_ID,
    personaName: 'Late order',
    agentId: AGENT_ID,
    status: 'pending',
    turnsCompleted: 0,
    maxTurns: 6,
    messages: [],
    toolExecutions: [],
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-09-30T10:00:00Z',
    ...overrides,
  };
}

describe('test personas', () => {
  it('lists the personas of one agent', async () => {
    const fake = new FakeWassist().on('GET', '/api/v1/test-personas/', [persona]);
    session = await connectTools(fake);
    const { data } = await session.call('wassist_list_test_personas', { agentId: AGENT_ID });

    expect(fake.requests[0]?.url.search).toBe(`?agent=${AGENT_ID}`);
    expect(data).toEqual({ items: [persona], total: 1, nextOffset: null });
  });

  it('creates a persona for an agent', async () => {
    const fake = new FakeWassist().on('POST', '/api/v1/test-personas/', persona);
    session = await connectTools(fake);
    const { data } = await session.call('wassist_create_test_persona', {
      agentId: AGENT_ID,
      name: persona.name,
      description: persona.description,
    });

    expect(fake.requests[0]?.body).toEqual({
      agent: AGENT_ID,
      name: persona.name,
      description: persona.description,
    });
    expect(data).toEqual(persona);
  });
});

describe('wassist_start_test_run', () => {
  it('starts a run and returns where it stands', async () => {
    const fake = new FakeWassist().on('POST', '/api/v1/test-runs/', upstreamRun());
    session = await connectTools(fake);
    const { data } = await session.call('wassist_start_test_run', {
      personaId: PERSONA_ID,
      maxTurns: 6,
    });

    expect(fake.requests[0]?.body).toEqual({ personaId: PERSONA_ID, maxTurns: 6 });
    expect(data).toMatchObject({ id: RUN_ID, status: 'pending', finished: false, maxTurns: 6 });
  });

  it('leaves the turn count to Wassist when none is given', async () => {
    const fake = new FakeWassist().on('POST', '/api/v1/test-runs/', upstreamRun());
    session = await connectTools(fake);
    await session.call('wassist_start_test_run', { personaId: PERSONA_ID });

    expect(fake.requests[0]?.body).toEqual({ personaId: PERSONA_ID });
  });

  it('never retries the start, so a lost answer cannot start a second run', async () => {
    const fake = new FakeWassist().on('POST', '/api/v1/test-runs/', json({}, 503));
    session = await connectTools(fake);
    const { data } = await session.call('wassist_start_test_run', { personaId: PERSONA_ID });

    expect(fake.requests).toHaveLength(1);
    expect(data.error).toMatchObject({ code: 'upstream_error', outcomeUnknown: true });
  });
});

describe('wassist_get_test_run', () => {
  it('reads a finished run with its transcript in the test chat message shape', async () => {
    const fake = new FakeWassist().on(
      'GET',
      `/api/v1/test-runs/${RUN_ID}/`,
      upstreamRun({
        status: 'completed',
        turnsCompleted: 1,
        completedAt: '2026-09-30T10:02:00Z',
        messages: [
          { role: 'user', messageType: 'text', content: { body: 'Where is my cake?' } },
          { role: 'assistant', messageType: 'text', content: { body: 'Let me check.' } },
          { role: 'assistant', messageType: 'image', content: { url: 'https://x' } },
        ],
      }),
    );
    session = await connectTools(fake);
    const { data } = await session.call('wassist_get_test_run', { testRunId: RUN_ID });

    expect(data).toMatchObject({
      status: 'completed',
      finished: true,
      transcriptReadable: true,
      transcript: [
        { role: 'user', type: 'text', text: 'Where is my cake?' },
        { role: 'assistant', type: 'text', text: 'Let me check.' },
        { role: 'assistant', type: 'image', text: null },
      ],
    });
  });

  it('lists the tools the agent ran, without their arguments or results', async () => {
    // The shape the live API sent on 2026-09-30, with the customer's order number in the arguments.
    const fake = new FakeWassist().on(
      'GET',
      `/api/v1/test-runs/${RUN_ID}/`,
      upstreamRun({
        status: 'completed',
        toolExecutions: [
          {
            id: 't1',
            toolName: 'check_order_status',
            toolType: 'api',
            args: { path_params: { order_id: 'ORDER-SECRET-123' } },
            result: { value: 'Unknown content type' },
            error: '',
            durationMs: 55,
            createdAt: '2026-09-30T03:13:07Z',
          },
        ],
      }),
    );
    session = await connectTools(fake);
    const { data } = await session.call('wassist_get_test_run', { testRunId: RUN_ID });

    expect(data.toolExecutions).toEqual([
      { toolName: 'check_order_status', toolType: 'api', error: null, durationMs: 55 },
    ]);
    expect(JSON.stringify(data)).not.toContain('ORDER-SECRET-123');
  });

  it('reports a transcript it cannot read instead of failing the call', async () => {
    const fake = new FakeWassist().on(
      'GET',
      `/api/v1/test-runs/${RUN_ID}/`,
      upstreamRun({ status: 'running', messages: 'not json' }),
    );
    session = await connectTools(fake);
    const { isError, data } = await session.call('wassist_get_test_run', { testRunId: RUN_ID });

    expect(isError).toBe(false);
    expect(data).toMatchObject({ status: 'running', transcript: [], transcriptReadable: false });
  });
});
