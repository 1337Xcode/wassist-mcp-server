import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createWassistApi } from '../../src/api.js';
import { createWassistServer } from '../../src/server.js';
import { selectTools, TOOLSET_NAMES, type ToolsetName } from '../../src/tools.js';
import type { FakeWassist } from './fake-wassist.js';

/** The two protocol revisions the server answers: the 2025 handshake and 2026-07-28. */
export type Era = 'legacy' | 'modern';

// biome-ignore lint/suspicious/noExplicitAny: tool output shapes differ per tool and each test asserts the exact literal
export type ToolData = any;

/** A connected MCP client, plus a helper that calls a tool and unwraps its result. */
export interface Session {
  client: Client;
  /** Calls a tool and returns the structured data, or the parsed error body when the tool failed. */
  call(name: string, args?: Record<string, unknown>): Promise<{ isError: boolean; data: ToolData }>;
  close(): Promise<void>;
}

/** Our own failures are JSON. Errors raised by the SDK's input validation are plain text. */
function parseErrorText(text: string): ToolData {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

/** Starts the server against a fake Wassist and connects a real MCP client to it. */
export async function connectTools(
  fake: FakeWassist,
  options: { readOnly?: boolean; toolsets?: readonly ToolsetName[]; era?: Era } = {},
): Promise<Session> {
  const build = () =>
    createWassistServer({
      api: createWassistApi(fake.createHttp()),
      tools: selectTools({
        readOnly: options.readOnly ?? false,
        toolsets: options.toolsets ?? TOOLSET_NAMES,
      }),
    });
  const legacy = options.era === 'legacy';
  const client = new Client(
    { name: 'tests', version: '0.0.0' },
    legacy ? {} : { versionNegotiation: { mode: 'auto' } },
  );
  let closeServer = async () => {};

  if (legacy) {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const server = build();
    await server.connect(serverSide);
    await client.connect(clientSide);
    closeServer = () => server.close();
  } else {
    const handler = createMcpHandler(build);
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
        fetch: (url, init) => handler.fetch(new Request(url, init)),
      }),
    );
    closeServer = () => handler.close();
  }

  return {
    client,
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
      return {
        isError: result.isError === true,
        data: result.isError ? parseErrorText(text) : result.structuredContent,
      };
    },
    async close() {
      await client.close();
      await closeServer();
    },
  };
}
