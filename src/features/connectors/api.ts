import { z } from 'zod';
import { textOrEmpty, textOrNull, truncate } from '../../wassist/fields.js';
import type { WassistHttp } from '../../wassist/http.js';
import { fetchAll, fetchList, mapPage, type Page, type PageParams } from '../../wassist/list.js';

// A connector is an MCP server that Wassist agents can call tools on. The organization's own
// connectors can be attached to agents. The catalog lists public servers a person can connect
// in the dashboard, which usually means an OAuth sign-in with that service.

/** Caps that keep a connector with a long description or many tools cheap to list. */
const DESCRIPTION_LENGTH = 300;
const MAX_TOOL_NAMES = 100;

// The raw schema accepts what Wassist sends. `inputSchema` on each known tool is never parsed.
const rawConnector = z.object({
  id: z.string(),
  name: textOrEmpty,
  description: textOrEmpty,
  slug: textOrNull,
  url: textOrEmpty,
  status: textOrNull,
  knownTools: z
    .array(z.object({ name: z.string() }))
    .nullish()
    .transform((tools) => (tools ?? []).map((tool) => tool.name)),
});

/** A connector and the tool names Wassist knows it offers. */
export const connectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  slug: z.string().nullable(),
  host: z
    .string()
    .nullable()
    .describe('Where the MCP server runs. Only the host is shown, since a URL can carry a token.'),
  status: z.string().nullable(),
  tools: z
    .array(z.string())
    .describe('Tool names, up to 100. Empty when Wassist has not synced them.'),
  toolCount: z.number(),
});

export type Connector = z.infer<typeof connectorSchema>;

/** Where a connector list comes from. */
export type ConnectorScope = 'connected' | 'catalog';

/** Paths for each scope. The catalog path is public data, the same for every organization. */
const PATHS: Record<ConnectorScope, string> = {
  connected: '/integrations/connectors/',
  catalog: '/integrations/connectors/public/',
};

/** The host of a connector URL, or null when it does not parse. */
function hostOf(url: string): string | null {
  return URL.canParse(url) ? new URL(url).host : null;
}

/** Shortens the description and the tool list, and swaps the URL for its host. */
function toConnector(connector: z.output<typeof rawConnector>): Connector {
  return {
    id: connector.id,
    name: connector.name,
    description: truncate(connector.description, DESCRIPTION_LENGTH),
    slug: connector.slug,
    host: hostOf(connector.url),
    status: connector.status,
    tools: connector.knownTools.slice(0, MAX_TOOL_NAMES),
    toolCount: connector.knownTools.length,
  };
}

/** Operations on /integrations/connectors/. */
export function connectorsApi(http: WassistHttp) {
  return {
    /**
     * GET /integrations/connectors/ or its public catalog. Both answer with the whole list, so
     * the page is cut here. The OpenAPI file declares one object for the catalog, but the live
     * API answers with a list.
     */
    async list(
      scope: ConnectorScope,
      page: PageParams,
      signal?: AbortSignal,
    ): Promise<Page<Connector>> {
      return mapPage(
        await fetchAll(http, PATHS[scope], {}, rawConnector, page, signal),
        toConnector,
      );
    },

    /** Finds one of the organization's connectors by id, with its full list of tool names. */
    async findConnected(
      id: string,
      signal?: AbortSignal,
    ): Promise<{ name: string; tools: string[] } | undefined> {
      const connectors = await fetchList(http, PATHS.connected, rawConnector, signal);
      const found = connectors.find((connector) => connector.id === id);
      return found && { name: found.name, tools: found.knownTools };
    },
  };
}
