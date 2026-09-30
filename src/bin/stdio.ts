#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createWassistApi } from '../api.js';
import { ConfigError, loadStdioConfig } from '../config.js';
import { logger } from '../logger.js';
import { createWassistServer } from '../server.js';
import { selectTools } from '../tools.js';
import { VERSION } from '../version.js';
import { WassistHttp } from '../wassist/http.js';

/** Reads the key from the environment, serves MCP on stdin and stdout, and stops cleanly on SIGINT and SIGTERM. */
function main(): void {
  const config = loadStdioConfig(process.env);
  const api = createWassistApi(
    new WassistHttp({ apiKey: config.apiKey, userAgent: `wassist-mcp-server/${VERSION}` }),
  );

  const tools = selectTools(config.tools);

  const handle = serveStdio(() => createWassistServer({ api, tools }), {
    onerror: (error) => logger.error('mcp transport error', { error: error.message }),
  });
  logger.info('wassist-mcp-server ready on stdio', {
    version: VERSION,
    ...config.tools,
    tools: tools.length,
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void handle.close().finally(() => process.exit(0)));
  }
}

try {
  main();
} catch (error) {
  if (error instanceof ConfigError) {
    process.stderr.write(`wassist-mcp-server: ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
