#!/usr/bin/env node
// Packs the stdio server as a Claude Desktop extension (.mcpb) and smoke-tests the bundle before packing.
// Run `npm run build:mcpb`. The result lands in packaging/mcpb/dist.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { allTools } from '../dist/tools.js';
import { bundleServer } from './lib/bundle.mjs';

// Pinned so the packaged bundle does not change when the CLI does.
const MCPB_CLI = '@anthropic-ai/mcpb@2.1.2';
// Resolves a path relative to this script.
const at = (relative) => fileURLToPath(new URL(relative, import.meta.url));

const pkg = JSON.parse(readFileSync(at('../package.json'), 'utf8'));
const stage = at('../packaging/mcpb/build');
const outDir = at('../packaging/mcpb/dist');
const bundle = `${stage}/server/index.mjs`;

rmSync(stage, { recursive: true, force: true });
mkdirSync(`${stage}/server`, { recursive: true });
mkdirSync(outDir, { recursive: true });

writeFileSync(bundle, await bundleServer());

copyFileSync(at('../assets/icon.png'), `${stage}/icon.png`);
copyFileSync(at('../LICENSE'), `${stage}/LICENSE`);

const template = JSON.parse(readFileSync(at('../packaging/mcpb/manifest.json'), 'utf8'));
const manifest = {
  ...template,
  version: pkg.version,
  tools: allTools.map((tool) => ({
    name: tool.name,
    description: `${tool.description.split('. ')[0].replace(/\.$/, '')}.`,
  })),
  tools_generated: false,
};
writeFileSync(`${stage}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

const client = new Client({ name: 'mcpb-smoke-test', version: '0.0.0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [bundle],
    env: {
      ...process.env,
      WASSIST_API_KEY: 'smoke-test-key-0123456789',
      WASSIST_READ_ONLY: 'false',
    },
    stderr: 'ignore',
  }),
);
const { tools } = await client.listTools();
const reported = client.getServerVersion()?.version;
await client.close();
if (tools.length !== allTools.length || reported !== pkg.version) {
  throw new Error(`Bundle smoke test failed: ${tools.length} tools, version ${reported}`);
}

const output = `${outDir}/wassist-mcp-server-${pkg.version}.mcpb`;
const pack = spawnSync(`npx --yes ${MCPB_CLI} pack "${stage}" "${output}"`, {
  stdio: 'inherit',
  shell: true,
});
if (pack.status !== 0) process.exit(pack.status ?? 1);
process.stdout.write(
  `Smoke test passed (${tools.length} tools, version ${reported}).\nWrote ${output}\n`,
);
