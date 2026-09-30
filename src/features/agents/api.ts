import { z } from 'zod';
import { numberOrZero, textOrEmpty, textOrNull } from '../../wassist/fields.js';
import { apiPath, type WassistHttp } from '../../wassist/http.js';
import { fetchPage, mapPage, type Page, type PageParams } from '../../wassist/list.js';
import { capabilitiesSchema, rawCapabilities, toCapabilities } from '../capabilities/api.js';

// The raw schema accepts what Wassist sends and tolerates null and missing fields.
// The exported schemas define what the tools return, and clients see them as the output schema.

// Fields the tools must not expose, such as API tool schemas with their headers and outbound
// trigger secrets, are left out of this schema, so parsing drops them.
const rawAgent = z
  .object({
    id: z.string(),
    name: z.string(),
    description: textOrEmpty,
    systemPrompt: textOrEmpty,
    firstMessage: textOrEmpty,
    icebreakers: z
      .array(z.unknown())
      .nullish()
      .transform((items) => (items ?? []).filter((item) => typeof item === 'string')),
    llmModel: textOrNull,
    reasoningEffort: textOrNull,
    phoneNumbers: z
      .array(z.object({ phoneNumber: z.string() }))
      .nullish()
      .transform((numbers) => (numbers ?? []).map((entry) => entry.phoneNumber)),
    totalMessages: numberOrZero,
    totalSessions: numberOrZero,
    connectUrl: textOrNull,
    createdAt: z.string(),
  })
  .extend(rawCapabilities.shape);

/** An agent as a list shows it. Short on purpose, so a long list stays cheap to read. */
export const agentSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  llmModel: z.string().nullable(),
  phoneNumbers: z.array(z.string()),
  createdAt: z.string(),
});

/** An agent in full. Its tools appear by name and purpose, never with their credentials. */
export const agentDetailSchema = agentSummarySchema.extend({
  systemPrompt: z.string(),
  firstMessage: z.string(),
  icebreakers: z.array(z.string()),
  reasoningEffort: z.string().nullable(),
  capabilities: capabilitiesSchema,
  totalMessages: z.number(),
  totalSessions: z.number(),
  connectUrl: z
    .string()
    .nullable()
    .describe(
      'A WhatsApp link that opens a chat with a /connect message for this agent. Use it to try the agent on the sandbox number.',
    ),
});

export type AgentSummary = z.infer<typeof agentSummarySchema>;
export type AgentDetail = z.infer<typeof agentDetailSchema>;

/**
 * Only fields that are plain values on the agent. The tool lists are edited by the capability
 * tools instead, because Wassist replaces a list whole and deletes what a write leaves out.
 */
export interface AgentChanges {
  name?: string;
  description?: string;
  systemPrompt?: string;
  firstMessage?: string;
  icebreakers?: string[];
  llmModel?: string;
  reasoningEffort?: string;
}

type RawAgent = z.output<typeof rawAgent>;

/** Keeps the fields a list needs. */
function toSummary(agent: RawAgent): AgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    llmModel: agent.llmModel,
    phoneNumbers: agent.phoneNumbers,
    createdAt: agent.createdAt,
  };
}

/** Adds the prompt, the first message and the capabilities to the summary. */
function toDetail(agent: RawAgent): AgentDetail {
  return {
    ...toSummary(agent),
    systemPrompt: agent.systemPrompt,
    firstMessage: agent.firstMessage,
    icebreakers: agent.icebreakers,
    reasoningEffort: agent.reasoningEffort,
    capabilities: toCapabilities(agent),
    totalMessages: agent.totalMessages,
    totalSessions: agent.totalSessions,
    connectUrl: agent.connectUrl,
  };
}

/** Operations on /agents/. */
export function agentsApi(http: WassistHttp) {
  return {
    /** GET /agents/. Wassist pages this endpoint itself. */
    async list(page: PageParams, signal?: AbortSignal): Promise<Page<AgentSummary>> {
      return mapPage(await fetchPage(http, '/agents/', {}, rawAgent, page, signal), toSummary);
    },

    /** GET /agents/{id}/. */
    async get(id: string, signal?: AbortSignal): Promise<AgentDetail> {
      const agent = await http.request(
        { method: 'GET', path: apiPath`/agents/${id}/` },
        rawAgent,
        signal,
      );
      return toDetail(agent);
    },

    /** POST /agents/. Wassist needs only a name. Everything else is set later with `update`. */
    async create(name: string, signal?: AbortSignal): Promise<AgentDetail> {
      const agent = await http.request(
        { method: 'POST', path: '/agents/', body: { name } },
        rawAgent,
        signal,
      );
      return toDetail(agent);
    },

    /** PATCH /agents/{id}/. Sends only the fields in `changes`, so nothing else is touched. */
    async update(id: string, changes: AgentChanges, signal?: AbortSignal): Promise<AgentDetail> {
      const agent = await http.request(
        { method: 'PATCH', path: apiPath`/agents/${id}/`, body: changes },
        rawAgent,
        signal,
      );
      return toDetail(agent);
    },
  };
}
