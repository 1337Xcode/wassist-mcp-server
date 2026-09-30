import { z } from 'zod';
import {
  numberOrZero,
  rawToolExecutions,
  textOrEmpty,
  textOrNull,
  toolExecutionSchema,
  truncate,
} from '../../wassist/fields.js';
import { apiPath, type WassistHttp } from '../../wassist/http.js';
import { fetchAll, type Page, type PageParams } from '../../wassist/list.js';

// A test persona describes a simulated customer. A test run lets Wassist play that customer
// against an agent for a number of turns in the background, the way a test chat does by hand.

/** Caps that keep a long run from flooding the model's context. */
const MAX_TRANSCRIPT_MESSAGES = 100;
const MESSAGE_TEXT_LENGTH = 2000;

/** Statuses after which a run will not change again. */
const FINISHED = new Set(['completed', 'failed', 'cancelled']);

// The raw schemas accept what Wassist sends and tolerate null and missing fields.
const rawPersona = z.object({
  id: z.string(),
  name: textOrEmpty,
  description: textOrEmpty,
  agentId: textOrNull,
  createdAt: textOrEmpty,
});

/** A simulated customer that test runs play against an agent. */
export const personaSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  agentId: z.string().nullable(),
  createdAt: z.string(),
});

export type Persona = z.infer<typeof personaSchema>;

/**
 * One message of a run's conversation. The OpenAPI file types `messages` as a string, but the
 * live API sends a list in the same shape as test chat messages, observed on 2026-09-30.
 */
const rawTranscriptMessage = z.object({
  role: textOrEmpty,
  messageType: textOrEmpty,
  content: z.record(z.string(), z.unknown()).nullish(),
});

// A test run as Wassist sends it. `messages` is left unparsed here and read by transcriptOf, so a
// transcript in an unexpected shape does not hide the run's status.
const rawRun = z.object({
  id: z.string(),
  personaName: textOrEmpty,
  status: textOrEmpty,
  turnsCompleted: numberOrZero,
  maxTurns: numberOrZero,
  errorMessage: textOrNull,
  startedAt: textOrNull,
  completedAt: textOrNull,
  messages: z.unknown().optional(),
  toolExecutions: rawToolExecutions.catch([]),
});

/** One turn of a test run's conversation. */
const transcriptMessageSchema = z.object({
  role: z.string().describe('user for the simulated customer, assistant for the agent.'),
  type: z.string(),
  text: z.string().nullable().describe('Null for a message with no text, such as an image.'),
});

/** Where a test run stands. */
export const testRunSummarySchema = z.object({
  id: z.string(),
  personaName: z.string(),
  status: z
    .string()
    .describe('pending, running, completed, failed or cancelled, as Wassist reports it.'),
  finished: z.boolean().describe('True once the run will not change again.'),
  turnsCompleted: z.number(),
  maxTurns: z.number(),
  errorMessage: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

/** A test run with the conversation it produced. */
export const testRunSchema = testRunSummarySchema.extend({
  transcript: z
    .array(transcriptMessageSchema)
    .describe('The conversation so far, oldest first, up to the latest 100 messages.'),
  transcriptReadable: z
    .boolean()
    .describe('False when Wassist sent the conversation in a shape this server cannot read.'),
  toolExecutions: z
    .array(toolExecutionSchema)
    .describe('The tools the agent ran during the run, oldest first, up to the latest 100.'),
});

export type TestRunSummary = z.infer<typeof testRunSummarySchema>;
export type TestRun = z.infer<typeof testRunSchema>;

type RawRun = z.output<typeof rawRun>;

/** Reads the transcript, or reports it unreadable instead of failing the whole call. */
function transcriptOf(value: unknown): Pick<TestRun, 'transcript' | 'transcriptReadable'> {
  const parsed = z.array(rawTranscriptMessage).nullish().safeParse(value);
  if (!parsed.success) return { transcript: [], transcriptReadable: false };
  const transcript = (parsed.data ?? []).slice(-MAX_TRANSCRIPT_MESSAGES).map((message) => {
    const body = message.content?.body;
    return {
      role: message.role,
      type: message.messageType,
      text: typeof body === 'string' ? truncate(body, MESSAGE_TEXT_LENGTH) : null,
    };
  });
  return { transcript, transcriptReadable: true };
}

/** Keeps the fields that say where a run stands. */
function toSummary(run: RawRun): TestRunSummary {
  return {
    id: run.id,
    personaName: run.personaName,
    status: run.status,
    finished: FINISHED.has(run.status),
    turnsCompleted: run.turnsCompleted,
    maxTurns: run.maxTurns,
    errorMessage: run.errorMessage,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

/** Operations on /test-personas/ and /test-runs/. */
export function testRunsApi(http: WassistHttp) {
  return {
    /** GET /test-personas/?agent=. Wassist answers with the whole list, so the page is cut here. */
    listPersonas(agentId: string, page: PageParams, signal?: AbortSignal): Promise<Page<Persona>> {
      return fetchAll(http, '/test-personas/', { agent: agentId }, rawPersona, page, signal);
    },

    /** POST /test-personas/. */
    createPersona(
      agentId: string,
      persona: { name: string; description: string },
      signal?: AbortSignal,
    ): Promise<Persona> {
      return http.request(
        { method: 'POST', path: '/test-personas/', body: { agent: agentId, ...persona } },
        rawPersona,
        signal,
      );
    },

    /** POST /test-runs/. The run happens in the background. `maxTurns` is left to Wassist when absent. */
    async start(
      personaId: string,
      maxTurns: number | undefined,
      signal?: AbortSignal,
    ): Promise<TestRunSummary> {
      const run = await http.request(
        { method: 'POST', path: '/test-runs/', body: { personaId, maxTurns } },
        rawRun,
        signal,
      );
      return toSummary(run);
    },

    /** GET /test-runs/{id}/, with the conversation so far. */
    async get(id: string, signal?: AbortSignal): Promise<TestRun> {
      const run = await http.request(
        { method: 'GET', path: apiPath`/test-runs/${id}/` },
        rawRun,
        signal,
      );
      return {
        ...toSummary(run),
        ...transcriptOf(run.messages),
        toolExecutions: run.toolExecutions.slice(-MAX_TRANSCRIPT_MESSAGES),
      };
    },
  };
}
