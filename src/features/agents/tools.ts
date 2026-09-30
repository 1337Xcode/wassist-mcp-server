import { z } from 'zod';
import { idOf, pageOf, paging } from '../../mcp/inputs.js';
import { defineTool } from '../../mcp/tool.js';
import { agentDetailSchema, agentSummarySchema } from './api.js';

/** Lists agents a page at a time, as summaries so a long list stays short. Read only. */
const listAgents = defineTool({
  name: 'wassist_list_agents',
  title: 'List agents',
  description:
    "List the agents in your Wassist organization with their model and connected phone numbers. Use wassist_get_agent for one agent's full configuration.",
  effect: 'read',
  input: z.strictObject({ ...paging(50) }),
  output: pageOf(agentSummarySchema),
  run: (args, { api, signal }) => api.agents.list(args, signal),
});

/** Reads one agent in full. Tool credentials never get this far, because the API schema drops them. */
const getAgent = defineTool({
  name: 'wassist_get_agent',
  title: 'Get agent',
  description:
    "Get one agent's system prompt, first message, icebreakers, model and a summary of its tools and connected phone numbers. Tool credentials and request headers are never returned.",
  effect: 'read',
  input: z.strictObject({ agentId: idOf('agent') }),
  output: agentDetailSchema,
  run: ({ agentId }, { api, signal }) => api.agents.get(agentId, signal),
});

/** Creates an agent from a name alone. The prompt and the rest come later, from `wassist_update_agent`. */
const createAgent = defineTool({
  name: 'wassist_create_agent',
  title: 'Create agent',
  description:
    'Create a new managed agent with only a name. It starts with an empty prompt and is not connected to any phone number, so it cannot reply to anyone yet. Set its prompt with wassist_update_agent.',
  effect: 'create',
  input: z.strictObject({
    name: z.string().min(1).max(255).describe('Display name for the agent.'),
  }),
  output: agentDetailSchema,
  run: ({ name }, { api, signal }) => api.agents.create(name, signal),
});

/**
 * Changes plain fields on an agent. The input schema is strict on purpose: Wassist replaces tool
 * collections as a whole and deletes what is missing, so fields such as `tools` are rejected here.
 * An update with no fields is rejected too, before any request is made.
 */
const updateAgent = defineTool({
  name: 'wassist_update_agent',
  title: 'Update agent',
  description:
    "Change an agent's name, description, system prompt, first message, icebreakers, model or reasoning effort. Only the fields you pass change, and each one is replaced in full, so read the current value with wassist_get_agent before editing a prompt. Icebreakers replace the whole list. Tools, documents and other settings are not editable here. If the agent is connected to a live number, customers see the change on their next message.",
  effect: 'update',
  input: z
    .strictObject({
      agentId: idOf('agent'),
      name: z.string().min(1).max(255).optional().describe('New display name.'),
      description: z
        .string()
        .max(2000)
        .optional()
        .describe('Short summary of what the agent does.'),
      systemPrompt: z
        .string()
        .max(50_000)
        .optional()
        .describe("The agent's instructions. Replaces the current prompt."),
      firstMessage: z
        .string()
        .max(4096)
        .optional()
        .describe('Welcome message sent when a conversation starts.'),
      icebreakers: z
        .array(z.string().min(1).max(100))
        .max(4)
        .optional()
        .describe('Up to 4 quick-start suggestions. Replaces the current list.'),
      llmModel: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe(
          'Model ID, for example openai/gpt-4.1-mini. Wassist requires a paid plan to change the model.',
        ),
      reasoningEffort: z
        .string()
        .min(1)
        .max(20)
        .optional()
        .describe('How much the model reasons before replying, from none to xhigh.'),
    })
    .refine(
      ({ agentId: _agentId, ...changes }) =>
        Object.values(changes).some((value) => value !== undefined),
      {
        message: 'Pass at least one field to change.',
      },
    ),
  output: agentDetailSchema,
  run: ({ agentId, ...changes }, { api, signal }) => api.agents.update(agentId, changes, signal),
});

/** Every agent tool, in the order clients list them. */
export const agentTools = [listAgents, getAgent, createAgent, updateAgent];
