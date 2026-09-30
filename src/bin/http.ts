#!/usr/bin/env node
import { ConfigError, loadHttpConfig } from '../config.js';
import { createHttpApp } from '../http/app.js';
import { logger } from '../logger.js';
import { VERSION } from '../version.js';

/** Reads the configuration, starts the HTTP server and stops it cleanly on SIGINT and SIGTERM. */
function main(): void {
  const config = loadHttpConfig(process.env);
  if (config.bindAddress === '0.0.0.0' || config.bindAddress === '::') {
    logger.warn(
      'BIND_ADDRESS exposes the server on every network interface. Put a TLS proxy in front of it.',
    );
  }

  if (config.oauth?.secretIsEphemeral) {
    logger.warn(
      'OAUTH_SECRET is not set, so sign-ins end whenever this server restarts. Set it to a fixed random value of 32 or more characters.',
    );
  }

  const app = createHttpApp({ config });
  app.server.on('error', (error) => {
    logger.error('http server error', { error: error.message });
    process.exit(1);
  });
  app.server.listen(config.port, config.bindAddress, () => {
    logger.info('wassist-mcp-server ready on http', {
      version: VERSION,
      url: `http://${config.bindAddress}:${config.port}/mcp`,
      ...config.tools,
      allowedHosts: config.allowedHosts,
      oauth: config.oauth?.publicUrl ?? false,
    });
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void app.close().finally(() => process.exit(0)));
  }
}

try {
  main();
} catch (error) {
  if (error instanceof ConfigError) {
    process.stderr.write(`wassist-mcp-server-http: ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
