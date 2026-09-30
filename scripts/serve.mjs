#!/usr/bin/env node
/**
 * Guided way to run the HTTP server: builds once, loads .env, accepts the public
 * address as an argument, prints the link each client needs, then starts the server.
 *
 *   npm run serve                            local-only server on http://localhost:8080/mcp
 *   npm run serve -- https://your-tunnel     public connector, sign-in page on
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const system = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform];

// .env is optional; a real environment wins over nothing, and the file fills the gaps.
try {
  process.loadEnvFile?.(join(root, '.env'));
} catch {
  // No .env, or an older Node without loadEnvFile: the process environment is enough.
}

// The one argument is the public address. It overrides PUBLIC_URL from the environment.
const address = process.argv[2];
if (address !== undefined) {
  let url;
  try {
    url = new URL(address);
  } catch {
    url = undefined;
  }
  const loopback = url && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (!url || (url.protocol !== 'https:' && !loopback) || url.pathname !== '/') {
    console.error(
      `Address "${address}" must be an https:// origin with no path, for example https://mcp.example.com`,
    );
    process.exit(2);
  }
  process.env.PUBLIC_URL = url.origin;
}

if (!existsSync(join(root, 'dist/bin/http.js'))) {
  console.log('First run: building the server…');
  const built = spawnSync('npm', ['run', 'build'], {
    cwd: root,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

const port = process.env.PORT ?? '8080';
const publicUrl = process.env.PUBLIC_URL;
console.log(`Wassist MCP server on ${system ?? process.platform}`);
if (publicUrl !== undefined) {
  console.log('');
  console.log('Connector link for web apps (Claude.ai, ChatGPT, Perplexity):');
  console.log(`  ${publicUrl}/mcp`);
  console.log('Each person pastes their Wassist API key on the sign-in page it serves.');
} else {
  console.log('');
  console.log(`Local connector link: http://localhost:${port}/mcp`);
  console.log(
    `  Claude Code: claude mcp add --transport http wassist http://localhost:${port}/mcp --header "X-API-Key: <your key>"`,
  );
  console.log('Web apps need a public HTTPS address. Deploy the server, or try it with a tunnel:');
  console.log(`  cloudflared tunnel --url http://localhost:${port}   (or: ngrok http ${port})`);
  console.log('then start it with that address:');
  console.log('  npm run serve -- https://your-tunnel-address');
}
console.log('');
console.log(
  !process.env.WASSIST_API_KEY
    ? 'WASSIST_API_KEY is not set: callers sign in or send X-API-Key themselves.'
    : 'WASSIST_API_KEY is set for stdio use; callers can also use the sign-in page or a header.',
);
console.log('Press Ctrl+C to stop.');

// A file URL, because ESM cannot import a bare Windows path such as C:\...\http.js.
await import(pathToFileURL(join(root, 'dist/bin/http.js')).href);
