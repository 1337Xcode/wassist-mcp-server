import { z } from 'zod';
import { pageOf, paging } from '../../mcp/inputs.js';
import { defineTool } from '../../mcp/tool.js';
import { connectorSchema } from './api.js';

/** Lists the organization's MCP connectors, or the public catalog of servers it could connect. Read only. */
const listConnectors = defineTool({
  name: 'wassist_list_connectors',
  title: 'List MCP connectors',
  description:
    "List MCP connectors, outside servers such as Stripe, HubSpot, Notion or Slack whose tools a Wassist agent can call. scope connected lists the ones this organization has already set up, which wassist_set_agent_connector can attach to an agent. scope catalog lists public servers that are not set up yet. Connecting one of those needs a person: send them to Integrations, Connectors, New Connector in the Wassist dashboard, where they finish that service's sign-in, then list again with scope connected.",
  effect: 'read',
  input: z.strictObject({
    scope: z
      .enum(['connected', 'catalog'])
      .default('connected')
      .describe('connected for this organization, catalog for public servers it could add.'),
    ...paging(50),
  }),
  output: pageOf(connectorSchema),
  run: ({ scope, limit, offset }, { api, signal }) =>
    api.connectors.list(scope, { limit, offset }, signal),
});

/** Every connector tool, in the order clients list them. */
export const connectorTools = [listConnectors];
