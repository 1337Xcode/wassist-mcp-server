import type { AddressInfo } from 'node:net';
import type { HttpConfig } from '../../src/config.js';
import { createHttpApp, type HttpApp } from '../../src/http/app.js';
import { TOOLSET_NAMES } from '../../src/tools.js';
import type { FakeWassist } from './fake-wassist.js';

/** An HTTP app that is listening on a local port. */
export interface RunningApp {
  app: HttpApp;
  origin: string;
  mcpUrl: URL;
  close(): Promise<void>;
}

/** Test defaults: loopback, no sign-in, a generous rate limit and a small body limit. */
const defaultHttpConfig: HttpConfig = {
  port: 0,
  bindAddress: '127.0.0.1',
  allowedHosts: [],
  tools: { readOnly: false, toolsets: TOOLSET_NAMES },
  rateLimitPerMinute: 1000,
  maxBodyBytes: 64 * 1024,
};

/** Starts the HTTP app against a fake Wassist. Pass `listenPort` when the config has to know the port. */
export async function startApp(
  fake: FakeWassist,
  overrides: Partial<HttpConfig> = {},
  listenPort = 0,
): Promise<RunningApp> {
  const app = createHttpApp({ config: { ...defaultHttpConfig, ...overrides }, fetch: fake.fetch });
  await new Promise<void>((resolve) => app.server.listen(listenPort, '127.0.0.1', resolve));
  const { port } = app.server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return { app, origin, mcpUrl: new URL('/mcp', origin), close: () => app.close() };
}
