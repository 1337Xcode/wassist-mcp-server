import { z } from 'zod';
import type { WassistApi } from '../../api.js';
import { ToolError } from '../../mcp/failures.js';
import { idOf } from '../../mcp/inputs.js';
import { defineTool } from '../../mcp/tool.js';
import {
  agentConnectorSchema,
  apiToolEntry,
  apiToolSchema,
  BODY_METHODS,
  type Capabilities,
  COLLECTION_NAMES,
  type CollectionName,
  capabilitiesSchema,
  handoffSchema,
  type StoredEntry,
  websiteToolSchema,
} from './api.js';

/** The error for a write that went through but whose entry cannot be found afterwards. */
const notFoundAfterSave = () =>
  new ToolError(
    'conflict',
    'Wassist accepted the change, but the entry is not on the agent now. Read the agent with wassist_get_agent before trying again.',
  );

/** An https address, since Wassist calls it on the business's behalf. Braces mark path values. */
const httpsUrl = (example: string) =>
  z
    .string()
    .max(2048)
    .refine(
      (value) => {
        if (!URL.canParse(value)) return false;
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password;
      },
      { message: `Use a full https URL, for example ${example}.` },
    );

/**
 * Writes one list back and checks that every entry that was kept is still there. A missing one
 * means the list changed elsewhere at the same time, and since the write has already happened,
 * the model is told not to retry.
 */
async function writeAndCheck(
  api: WassistApi,
  agentId: string,
  name: CollectionName,
  keep: StoredEntry[],
  add: Record<string, unknown>[],
  signal: AbortSignal,
): Promise<Capabilities> {
  const capabilities = await api.capabilities.write(agentId, name, [...keep, ...add], signal);
  const saved: { id: string }[] = capabilities[name];
  const savedIds = new Set(saved.map((entry) => entry.id));
  const lost = keep.filter((entry) => !savedIds.has(entry.id));
  if (lost.length > 0) {
    throw new ToolError(
      'conflict',
      `The change was saved, but ${lost.length} entries that were already on the agent are gone. Someone probably edited the agent at the same time. Do not retry. Read the agent with wassist_get_agent and tell the user what is missing.`,
    );
  }
  return capabilities;
}

/** Attaches a connector to an agent, or changes which of its tools the agent may use. */
const setAgentConnector = defineTool({
  name: 'wassist_set_agent_connector',
  title: 'Attach MCP connector to agent',
  description: `Let an agent call tools from one of the organization's MCP connectors, such as Stripe or HubSpot, and choose which of its tools it may use. If the connector is already on the agent, its tool list is replaced with this one. The connector must already be set up in the organization: find it with wassist_list_connectors (scope connected). The agent starts using the tools on its next message, with customers too if it is connected to a live number.`,
  effect: 'update',
  input: z.strictObject({
    agentId: idOf('agent'),
    connectorId: idOf('connector'),
    tools: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(100)
      .describe('Names of the connector tools the agent may call. Give only what the agent needs.'),
  }),
  output: z.object({
    agentId: z.string(),
    connector: agentConnectorSchema,
    wasAttached: z
      .boolean()
      .describe('True when the connector was already on the agent and only its tool list changed.'),
    capabilities: capabilitiesSchema,
  }),
  run: async ({ agentId, connectorId, tools }, { api, signal }) => {
    const connector = await api.connectors.findConnected(connectorId, signal);
    if (!connector) {
      throw new ToolError(
        'not_found',
        'This organization has no connector with that id. Find one with wassist_list_connectors (scope connected). A connector from the catalog has to be connected in the Wassist dashboard first.',
      );
    }
    // Wassist syncs a connector's tools in the background, so an empty list means unknown, not none.
    const unknown =
      connector.tools.length > 0 ? tools.filter((tool) => !connector.tools.includes(tool)) : [];
    if (unknown.length > 0) {
      throw new ToolError(
        'invalid_input',
        `${connector.name} has no tool named ${unknown.slice(0, 5).join(', ')}. wassist_list_connectors shows the tools it offers.`,
      );
    }

    const { connectors: current } = await api.capabilities.read(agentId, signal);
    const existing = current.find((entry) => entry.connectorId === connectorId);
    const keep = current.map((entry) =>
      entry === existing ? { ...entry, toolWhitelist: tools } : entry,
    );
    const add = existing ? [] : [{ connectorId, toolWhitelist: tools }];
    const capabilities = await writeAndCheck(api, agentId, 'connectors', keep, add, signal);

    const saved = capabilities.connectors.find((entry) => entry.connectorId === connectorId);
    if (!saved) throw notFoundAfterSave();
    return { agentId, connector: saved, wasAttached: existing !== undefined, capabilities };
  },
});

/** Gives an agent a web page to read live when a customer's question needs it. */
const addWebsiteTool = defineTool({
  name: 'wassist_add_website_tool',
  title: 'Add website tool to agent',
  description: `Give an agent a web page it reads live when a question needs it, such as a price list, opening hours or a shipping policy. The prompt says what to look for on the page. Existing tools on the agent are kept.`,
  effect: 'create',
  input: z.strictObject({
    agentId: idOf('agent'),
    url: httpsUrl('https://example.com/shipping').describe('The page to read.'),
    prompt: z
      .string()
      .min(1)
      .max(1000)
      .describe('What to look for on the page, for example "Current prices and opening hours".'),
  }),
  output: z.object({
    agentId: z.string(),
    added: websiteToolSchema,
    capabilities: capabilitiesSchema,
  }),
  run: async ({ agentId, url, prompt }, { api, signal }) => {
    const { websiteTools: current } = await api.capabilities.read(agentId, signal);
    const duplicate = current.find((entry) => entry.url === url);
    if (duplicate) {
      throw new ToolError(
        'conflict',
        `The agent already reads this page (id ${duplicate.id}). To change its prompt, remove it with wassist_remove_agent_capability and add it again.`,
      );
    }
    const capabilities = await writeAndCheck(
      api,
      agentId,
      'websiteTools',
      current,
      [{ url, prompt }],
      signal,
    );
    const added = capabilities.websiteTools.find((entry) => entry.url === url);
    if (!added) throw notFoundAfterSave();
    return { agentId, added, capabilities };
  },
});

/** Lets one agent pass a conversation to another, which is how a triage setup is built. */
const addAgentHandoff = defineTool({
  name: 'wassist_add_agent_handoff',
  title: 'Add agent handoff',
  description: `Let an agent pass the conversation to another agent in the organization when a topic comes up, for example a front-desk agent that hands billing questions to a billing specialist. The other agent then continues the same WhatsApp conversation. Existing tools on the agent are kept.`,
  effect: 'create',
  input: z.strictObject({
    agentId: idOf('agent that hands over'),
    targetAgentId: idOf('agent that takes over'),
    description: z
      .string()
      .min(1)
      .max(1000)
      .describe('When to hand over, for example "Billing, invoices or refund questions".'),
  }),
  output: z.object({
    agentId: z.string(),
    added: handoffSchema,
    capabilities: capabilitiesSchema,
  }),
  run: async ({ agentId, targetAgentId, description }, { api, signal }) => {
    if (agentId === targetAgentId) {
      throw new ToolError('invalid_input', 'An agent cannot hand a conversation to itself.');
    }
    const { handoffs: current } = await api.capabilities.read(agentId, signal);
    const duplicate = current.find((entry) => entry.childAgentId === targetAgentId);
    if (duplicate) {
      throw new ToolError(
        'conflict',
        `The agent already hands over to that agent (id ${duplicate.id}). To change when, remove it with wassist_remove_agent_capability and add it again.`,
      );
    }
    const capabilities = await writeAndCheck(
      api,
      agentId,
      'handoffs',
      current,
      [{ childAgentId: targetAgentId, description }],
      signal,
    );
    const added = capabilities.handoffs.find((entry) => entry.agentId === targetAgentId);
    if (!added) throw notFoundAfterSave();
    return { agentId, added, capabilities };
  },
});

/** Where a value goes in the request, who fills it in, and whether it is needed. */
const apiToolParameter = z
  .strictObject({
    name: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/, 'Use letters, digits, _ . or -.')
      .describe('The parameter name as the endpoint expects it.'),
    in: z
      .enum(['path', 'query', 'body'])
      .describe(
        'path for a {name} placeholder in the URL, query for ?name=, body for a JSON field.',
      ),
    type: z.enum(['string', 'number', 'integer', 'boolean']).default('string'),
    required: z.boolean().default(true),
    description: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe(
        'Set this when the agent fills the value in from the conversation. Say what it is and what to do if the customer has not given it yet.',
      ),
    value: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe(
        'Set this instead for a fixed value, such as a constant flag or %PHONE_NUMBER% for the customer number. Never put a password or key here.',
      ),
  })
  .refine(
    (parameter) => (parameter.description === undefined) !== (parameter.value === undefined),
    {
      message: 'Give either description (the agent fills it in) or value (fixed), not both.',
    },
  );

/** Placeholders in a URL template, such as order_id in /orders/{order_id}. */
function placeholdersIn(url: string): string[] {
  return [...url.matchAll(/\{([^{}/]+)\}/g)].map((match) => match[1] ?? '');
}

/**
 * Gives an agent one HTTP request into the business's own systems. Headers are not accepted,
 * so no credential passes through the model: the person adds auth headers in the dashboard,
 * and later edits here keep them because existing entries are written back unchanged.
 */
const addApiTool = defineTool({
  name: 'wassist_add_api_tool',
  title: 'Add API tool to agent',
  description: `Give an agent one HTTP request it can make mid-conversation, such as looking up an order or booking a slot in the business's own system. The agent decides when to call it from the description, so say when to use it and what it needs. This tool takes no headers or secrets: if the endpoint needs an API key, tell the user to add the header to this tool in the Wassist dashboard under the agent's Capabilities, API Tools. The endpoint has 60 seconds to answer. Existing tools on the agent are kept.`,
  effect: 'create',
  input: z
    .strictObject({
      agentId: idOf('agent'),
      name: z
        .string()
        .regex(
          /^[a-z][a-z0-9_]{0,63}$/,
          'Use lowercase snake_case, for example check_order_status.',
        )
        .describe('Tool name the agent sees, in snake_case.'),
      description: z
        .string()
        .min(1)
        .max(1024)
        .describe(
          'When the agent should call it and what it needs, for example "Use when the customer asks where their order is. Needs an order number like ACM-12345."',
        ),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      url: httpsUrl('https://api.example.com/orders/{order_id}').describe(
        'The endpoint. Put path values in braces and describe each one as a path parameter.',
      ),
      parameters: z.array(apiToolParameter).max(30).default([]),
    })
    .superRefine((spec, ctx) => {
      const placeholders = placeholdersIn(spec.url);
      const pathNames = spec.parameters.filter((p) => p.in === 'path').map((p) => p.name);
      for (const name of placeholders.filter((p) => !pathNames.includes(p))) {
        ctx.addIssue({
          code: 'custom',
          path: ['parameters'],
          message: `Describe the {${name}} placeholder as a path parameter.`,
        });
      }
      for (const name of pathNames.filter((p) => !placeholders.includes(p))) {
        ctx.addIssue({
          code: 'custom',
          path: ['parameters'],
          message: `The URL has no {${name}} placeholder for this path parameter.`,
        });
      }
      if (!BODY_METHODS.has(spec.method) && spec.parameters.some((p) => p.in === 'body')) {
        ctx.addIssue({
          code: 'custom',
          path: ['parameters'],
          message: `${spec.method} requests have no body. Use query parameters.`,
        });
      }
      const seen = new Set<string>();
      for (const parameter of spec.parameters) {
        const key = `${parameter.in}:${parameter.name}`;
        if (seen.has(key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['parameters'],
            message: `${parameter.name} is listed twice in ${parameter.in}.`,
          });
        }
        seen.add(key);
      }
    }),
  output: z.object({
    agentId: z.string(),
    added: apiToolSchema,
    capabilities: capabilitiesSchema,
  }),
  run: async ({ agentId, ...spec }, { api, signal }) => {
    const { apiTools: current } = await api.capabilities.read(agentId, signal);
    const duplicate = current.find((entry) => entry.name === spec.name);
    if (duplicate) {
      throw new ToolError(
        'conflict',
        `The agent already has an API tool named ${spec.name} (id ${duplicate.id}). Pick another name, or remove it with wassist_remove_agent_capability first.`,
      );
    }
    const capabilities = await writeAndCheck(
      api,
      agentId,
      'apiTools',
      current,
      [apiToolEntry(spec)],
      signal,
    );
    const added = capabilities.apiTools.find((entry) => entry.name === spec.name);
    if (!added) throw notFoundAfterSave();
    return { agentId, added, capabilities };
  },
});

/** Removes one API tool, website tool, handoff or connector from an agent by its id. */
const removeAgentCapability = defineTool({
  name: 'wassist_remove_agent_capability',
  title: 'Remove agent capability',
  description: `Remove one API tool, website tool, handoff or connector from an agent, using the id shown under capabilities by wassist_get_agent. Everything else on the agent is kept. The agent stops using it on its next message, with customers too if it is connected to a live number. A removed API tool's settings, including any auth headers added in the dashboard, cannot be recovered.`,
  effect: 'update',
  input: z.strictObject({
    agentId: idOf('agent'),
    capabilityId: idOf('capability'),
  }),
  output: z.object({
    agentId: z.string(),
    removed: z.object({ id: z.string(), kind: z.enum(COLLECTION_NAMES) }),
    capabilities: capabilitiesSchema,
  }),
  run: async ({ agentId, capabilityId }, { api, signal }) => {
    const lists = await api.capabilities.read(agentId, signal);
    const kind = COLLECTION_NAMES.find((name) =>
      lists[name].some((entry) => entry.id === capabilityId),
    );
    if (!kind) {
      throw new ToolError(
        'not_found',
        'This agent has no API tool, website tool, handoff or connector with that id. Read the ids with wassist_get_agent. Documents are removed in the Wassist dashboard.',
      );
    }
    const keep = lists[kind].filter((entry) => entry.id !== capabilityId);
    const capabilities = await writeAndCheck(api, agentId, kind, keep, [], signal);
    const remaining: { id: string }[] = capabilities[kind];
    if (remaining.some((entry) => entry.id === capabilityId)) {
      throw new ToolError(
        'conflict',
        'Wassist accepted the change, but the entry is still on the agent. Read the agent with wassist_get_agent before trying again.',
      );
    }
    return { agentId, removed: { id: capabilityId, kind }, capabilities };
  },
});

/** Every capability tool, in the order clients list them. */
export const capabilityTools = [
  setAgentConnector,
  addApiTool,
  addWebsiteTool,
  addAgentHandoff,
  removeAgentCapability,
];
