import type { McpServer } from '@modelcontextprotocol/server';
import type { WassistApi } from '../api.js';
import { failureResult } from './failures.js';
import { ANNOTATIONS, type Tool } from './tool.js';

/**
 * Registers the tools on the server. Each call runs the tool with the API and the request's
 * cancel signal, returns the result as JSON text and structured content, and turns any failure
 * into an error result the model can read. Which tools to pass is decided by `selectTools`.
 */
export function registerTools(server: McpServer, tools: readonly Tool[], api: WassistApi): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        outputSchema: tool.output,
        annotations: ANNOTATIONS[tool.effect],
      },
      async (args, context) => {
        try {
          const result = await tool.run(args, { api, signal: context.mcpReq.signal });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } catch (error) {
          return failureResult(tool, error);
        }
      },
    );
  }
}
