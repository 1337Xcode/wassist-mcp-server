import { z } from 'zod';
import { countOf, textOrEmpty } from '../../wassist/fields.js';
import { apiPath, type WassistHttp } from '../../wassist/http.js';

// Wassist keeps an agent's tools as lists on the agent itself, and PATCH replaces a list whole:
// entries with an id are updated, entries without one are created, and missing ones are deleted.
// So every edit here reads the agent, writes back each existing entry exactly as it came, and
// changes only the one list it was asked to.

/** The agent lists these tools can edit, by the name tools use and the field Wassist uses. */
const COLLECTION_FIELDS = {
  apiTools: 'tools',
  websiteTools: 'websiteTools',
  handoffs: 'handoffTools',
  connectors: 'mcpConfigs',
} as const;

/** One of the agent lists that the capability tools add to and remove from. */
export type CollectionName = keyof typeof COLLECTION_FIELDS;

/** The editable lists in a fixed order, for searching all of them for one id. */
export const COLLECTION_NAMES = [
  'apiTools',
  'websiteTools',
  'handoffs',
  'connectors',
] as const satisfies readonly CollectionName[];

/** Wassist leaves `active` out on some entries. A missing value means the entry is on. */
const active = z
  .boolean()
  .nullish()
  .transform((value) => value ?? true);

/** A list field that may be missing or null, read as an empty list. */
const listOf = <T extends z.ZodType>(item: T) =>
  z
    .array(item)
    .nullish()
    .transform((items) => items ?? []);

/**
 * The capability lists as a reader sees them. An API tool's `apiSchema` is never parsed, because
 * it can hold fixed header values such as an API key for the business's own system.
 */
export const rawCapabilities = z.object({
  tools: listOf(z.object({ id: z.string(), name: z.string(), description: textOrEmpty, active })),
  websiteTools: listOf(z.object({ id: z.string(), url: z.string(), prompt: textOrEmpty, active })),
  handoffTools: listOf(
    z.object({
      id: z.string(),
      childAgentId: z.string(),
      childAgentName: textOrEmpty,
      description: textOrEmpty,
      active,
    }),
  ),
  mcpConfigs: listOf(
    z.object({
      id: z.string(),
      connectorId: z.string(),
      connectorName: textOrEmpty,
      toolWhitelist: listOf(z.unknown()).transform((tools) =>
        tools.filter((tool) => typeof tool === 'string'),
      ),
    }),
  ),
  documents: listOf(z.object({ id: z.string(), name: textOrEmpty, status: textOrEmpty })),
  imageGenerateTools: countOf,
});

/** An API tool: one HTTP request the agent can make. Its URL and fixed values stay hidden. */
export const apiToolSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  active: z.boolean(),
});

/** A web page the agent reads live when a question needs it. */
export const websiteToolSchema = z.object({
  id: z.string(),
  url: z.string(),
  prompt: z.string(),
  active: z.boolean(),
});

/** A hand-over to another agent in the organization, and when to make it. */
export const handoffSchema = z.object({
  id: z.string(),
  agentId: z.string().describe('The agent that takes over the conversation.'),
  agentName: z.string(),
  description: z.string().describe('When the agent hands over.'),
  active: z.boolean(),
});

/** An MCP connector attached to the agent, and which of its tools the agent may call. */
export const agentConnectorSchema = z.object({
  id: z.string(),
  connectorId: z.string(),
  connectorName: z.string(),
  tools: z.array(z.string()),
});

/** Everything an agent can use beyond its prompt. Each entry's `id` is what the remove tool takes. */
export const capabilitiesSchema = z.object({
  apiTools: z.array(apiToolSchema),
  websiteTools: z.array(websiteToolSchema),
  handoffs: z.array(handoffSchema),
  connectors: z.array(agentConnectorSchema),
  documents: z
    .array(z.object({ id: z.string(), name: z.string(), status: z.string() }))
    .describe('Knowledge files. They are uploaded and removed in the Wassist dashboard.'),
  imageGenerateTools: z.number(),
});

export type Capabilities = z.infer<typeof capabilitiesSchema>;

/** Renames Wassist's fields to the names the tools use. */
export function toCapabilities(raw: z.output<typeof rawCapabilities>): Capabilities {
  return {
    apiTools: raw.tools,
    websiteTools: raw.websiteTools,
    handoffs: raw.handoffTools.map(({ childAgentId, childAgentName, ...rest }) => ({
      ...rest,
      agentId: childAgentId,
      agentName: childAgentName,
    })),
    connectors: raw.mcpConfigs.map(({ toolWhitelist, ...rest }) => ({
      ...rest,
      tools: toolWhitelist,
    })),
    documents: raw.documents,
    imageGenerateTools: raw.imageGenerateTools,
  };
}

/**
 * An entry exactly as Wassist sent it. The loose object keeps every field, including the ones
 * this server never shows, so writing it back leaves the entry as it was.
 */
const storedEntry = z.looseObject({ id: z.string() });

export type StoredEntry = z.output<typeof storedEntry>;

/** The editable lists of one agent, each entry kept whole. */
const storedLists = z
  .object({
    tools: listOf(storedEntry),
    websiteTools: listOf(storedEntry),
    handoffTools: listOf(storedEntry),
    mcpConfigs: listOf(storedEntry),
  })
  .transform(
    (lists): Record<CollectionName, StoredEntry[]> => ({
      apiTools: lists.tools,
      websiteTools: lists.websiteTools,
      handoffs: lists.handoffTools,
      connectors: lists.mcpConfigs,
    }),
  );

/** One value in an API tool's request: where it goes and who fills it in. */
interface ApiToolParameter {
  name: string;
  in: 'path' | 'query' | 'body';
  type: 'string' | 'number' | 'integer' | 'boolean';
  required: boolean;
  /** Set when the agent fills the value in from the conversation. */
  description?: string;
  /** Set when the value is fixed. */
  value?: string;
}

/** What the add-API-tool tool collects. Headers are left out on purpose. */
export interface ApiToolSpec {
  name: string;
  description: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  parameters: ApiToolParameter[];
}

/** Methods whose request can carry a JSON body. */
export const BODY_METHODS: ReadonlySet<ApiToolSpec['method']> = new Set(['POST', 'PUT', 'PATCH']);

/** Builds the `apiSchema` the Wassist guide documents, from a flat list of parameters. */
export function apiToolEntry(spec: ApiToolSpec): Record<string, unknown> {
  const describe = (parameter: ApiToolParameter) => ({
    type: parameter.type,
    input:
      parameter.value === undefined
        ? { type: 'description', description: parameter.description ?? '' }
        : { type: 'value', value: parameter.value },
  });
  const group = (location: ApiToolParameter['in']) =>
    spec.parameters.filter((parameter) => parameter.in === location);
  const properties = (parameters: ApiToolParameter[]) =>
    Object.fromEntries(parameters.map((parameter) => [parameter.name, describe(parameter)]));
  const required = (parameters: ApiToolParameter[]) =>
    parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name);

  const query = group('query');
  const body = group('body');
  return {
    name: spec.name,
    description: spec.description,
    apiSchema: {
      url: spec.url,
      method: spec.method,
      path_params: properties(group('path')),
      query_params: { required: required(query), properties: properties(query) },
      request_headers: {},
      ...(BODY_METHODS.has(spec.method) && {
        request_body: { type: 'object', required: required(body), properties: properties(body) },
      }),
    },
  };
}

/** Reads and writes the capability lists on /agents/{id}/. */
export function capabilitiesApi(http: WassistHttp) {
  return {
    /** GET /agents/{id}/, keeping every entry of the editable lists whole. */
    read(agentId: string, signal?: AbortSignal): Promise<Record<CollectionName, StoredEntry[]>> {
      return http.request(
        { method: 'GET', path: apiPath`/agents/${agentId}/` },
        storedLists,
        signal,
      );
    },

    /**
     * PATCH /agents/{id}/ with one list and nothing else, so the prompt and the other lists are
     * untouched. `entries` must hold every entry to keep. Returns the agent's capabilities after
     * the write.
     */
    async write(
      agentId: string,
      name: CollectionName,
      entries: unknown[],
      signal?: AbortSignal,
    ): Promise<Capabilities> {
      const updated = await http.request(
        {
          method: 'PATCH',
          path: apiPath`/agents/${agentId}/`,
          body: { [COLLECTION_FIELDS[name]]: entries },
        },
        rawCapabilities,
        signal,
      );
      return toCapabilities(updated);
    },
  };
}
