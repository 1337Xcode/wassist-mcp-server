import { z } from 'zod';
import { idOf, pageOf, paging, phoneNumber } from '../../mcp/inputs.js';
import { defineTool } from '../../mcp/tool.js';
import { phoneNumberSchema } from './api.js';

/**
 * Required on both routing tools. Wassist does not document its default, and the value decides
 * whether conversations already running are moved, so the caller has to choose.
 */
const applyToExisting = z
  .boolean()
  .describe(
    'true also switches conversations already in progress on this number and restarts their sessions. false leaves them as they are.',
  );

/** Lists WhatsApp numbers with their routing. Read only. */
const listPhoneNumbers = defineTool({
  name: 'wassist_list_phone_numbers',
  title: 'List phone numbers',
  description:
    'List the WhatsApp numbers on your account, including the shared sandbox number, with the agent or webhook each one routes to.',
  effect: 'read',
  input: z.strictObject({ ...paging(50) }),
  output: pageOf(phoneNumberSchema),
  run: (args, { api, signal }) => api.phoneNumbers.list(args, signal),
});

/**
 * Points a number at an agent. The change is immediate and reaches real customers. Wassist refuses
 * it on the shared sandbox number when an API key is used, and `rejectionHint` says so.
 */
const connectAgentToNumber = defineTool({
  name: 'wassist_connect_agent_to_number',
  title: 'Connect agent to number',
  description:
    "Make an agent answer every new message on a WhatsApp number. This replaces the number's current agent or webhook immediately, so real customers start talking to this agent. Do not call this for a number whose isSandbox is true: API keys cannot change routing on the shared sandbox number, and Wassist answers 400. For the sandbox, give the user the agent's connectUrl (from wassist_get_agent) to open in WhatsApp, or send them to Numbers, Sandbox numbers in the dashboard.",
  effect: 'update',
  input: z.strictObject({
    number: phoneNumber,
    agentId: idOf('agent'),
    applyToExisting,
  }),
  output: phoneNumberSchema,
  rejectionHint:
    'This is the shared sandbox number, and API keys cannot route it, so do not retry. Give the user the agent connectUrl from wassist_get_agent to open in WhatsApp, or have them set routing in the dashboard under Numbers, Sandbox numbers.',
  run: ({ number, agentId, applyToExisting }, { api, signal }) =>
    api.phoneNumbers.connectAgent(number, agentId, { applyToExisting }, signal),
});

/**
 * Stops a number from replying, without deleting the number or its stored messages. The sandbox
 * number refuses this for API keys too.
 */
const clearNumberRouting = defineTool({
  name: 'wassist_clear_number_routing',
  title: 'Clear number routing',
  description:
    'Stop a WhatsApp number from replying. Incoming messages are still stored, but no agent or webhook handles them until you connect one again with wassist_connect_agent_to_number.',
  effect: 'update',
  input: z.strictObject({ number: phoneNumber, applyToExisting }),
  output: phoneNumberSchema,
  rejectionHint:
    'This is the shared sandbox number, and API keys cannot route it, so do not retry. Give the user the agent connectUrl from wassist_get_agent to open in WhatsApp, or have them set routing in the dashboard under Numbers, Sandbox numbers.',
  run: ({ number, applyToExisting }, { api, signal }) =>
    api.phoneNumbers.clearRouting(number, { applyToExisting }, signal),
});

/** Every phone number tool, in the order clients list them. */
export const phoneNumberTools = [listPhoneNumbers, connectAgentToNumber, clearNumberRouting];
