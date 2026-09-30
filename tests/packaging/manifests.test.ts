import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { describe, expect, it } from 'vitest';
import { allTools } from '../../src/tools.js';

// Paths are relative to the repository root.
const at = (relative: string) => fileURLToPath(new URL(`../../${relative}`, import.meta.url));
const read = (relative: string) => readFileSync(at(relative), 'utf8');
// biome-ignore lint/suspicious/noExplicitAny: each manifest has its own shape and the tests read only a few fields
const json = (relative: string): any => JSON.parse(read(relative));

// The manifests under test, read once.
const pkg = json('package.json');
const portablePlugin = json('plugins/wassist/plugin.json');
const portableMcp = json('plugins/wassist/mcp.json');
const claudePlugin = json('plugins/wassist/.claude-plugin/plugin.json');
const claudeMarketplace = json('.claude-plugin/marketplace.json');
const codexMarketplace = json('.agents/plugins/marketplace.json');
const mcpb = json('packaging/mcpb/manifest.json');
const gemini = json('gemini-extension.json');

describe('release manifests agree with package.json', () => {
  it('carry the same version (run `npm run version:sync` when this fails)', () => {
    expect(portablePlugin.version).toBe(pkg.version);
    expect(claudePlugin.version).toBe(pkg.version);
    expect(gemini.version).toBe(pkg.version);
    expect(claudeMarketplace.metadata.version).toBe(pkg.version);
    expect(claudeMarketplace.plugins[0].version).toBe(pkg.version);
  });

  it('use the same package name', () => {
    expect(mcpb.name).toBe(pkg.name);
  });

  it('point at the same repository', () => {
    const repository = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
    expect(portablePlugin.repository).toBe(repository);
    expect(claudePlugin.repository).toBe(repository);
    expect(mcpb.repository.url).toBe(repository);
    expect(pkg.homepage).toBe(`${repository}#readme`);
  });

  it('use the same plugin name and point marketplaces at a folder that exists', () => {
    expect(claudePlugin.name).toBe(portablePlugin.name);
    expect(claudeMarketplace.plugins[0].name).toBe(claudePlugin.name);
    expect(codexMarketplace.plugins[0].name).toBe(claudePlugin.name);
    expect(claudeMarketplace.plugins[0].source).toBe('./plugins/wassist');
    expect(codexMarketplace.plugins[0].source.path).toBe('./plugins/wassist');
  });

  it('ship the same icon as the brand assets', () => {
    expect(
      readFileSync(at('plugins/wassist/assets/icon.png')).equals(
        readFileSync(at('assets/icon.png')),
      ),
    ).toBe(true);
  });
});

// The plugin hosts expand this placeholder to the installed plugin folder.
const placeholder = (name: string) => `\${${name}}`;

describe('the Gemini CLI extension', () => {
  it('runs the same bundled server as the plugin, from the cloned repository', () => {
    const server = gemini.mcpServers.wassist;
    const sep = placeholder('/');
    const bundle = ['plugins', 'wassist', 'server', 'index.mjs'];

    expect(server.command).toBe('node');
    expect(server.args).toEqual([[placeholder('extensionPath'), ...bundle].join(sep)]);
    expect(readFileSync(at(bundle.join('/')), 'utf8').length).toBeGreaterThan(1000);
  });

  it('asks for the key at install and keeps it in the system keychain', () => {
    expect(gemini.settings).toEqual([
      expect.objectContaining({ envVar: 'WASSIST_API_KEY', sensitive: true }),
    ]);
  });
});

describe('the plugin runs its own bundled server', () => {
  it('starts the bundle from the plugin folder, with no npm install', () => {
    expect(portableMcp.mcpServers.wassist.command).toBe('node');
    expect(portableMcp.mcpServers.wassist.args).toEqual([
      `${placeholder('PLUGIN_ROOT')}/server/index.mjs`,
    ]);
    expect(claudePlugin.mcpServers.wassist.command).toBe('node');
    expect(claudePlugin.mcpServers.wassist.args).toEqual([
      `${placeholder('CLAUDE_PLUGIN_ROOT')}/server/index.mjs`,
    ]);
  });

  it('matches the current source (run `npm run build:plugin` when this fails)', () => {
    const check = spawnSync(process.execPath, [at('scripts/build-plugin-server.mjs'), '--check'], {
      encoding: 'utf8',
    });

    expect(check.stderr).toBe('');
    expect(check.status).toBe(0);
  });

  it('starts and lists every tool', async () => {
    const client = new Client({ name: 'bundle-test', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [at('plugins/wassist/server/index.mjs')],
        env: { PATH: process.env.PATH ?? '', WASSIST_API_KEY: 'bundle-test-key-0123456789' },
        stderr: 'ignore',
      }),
    );
    const { tools } = await client.listTools();
    const version = client.getServerVersion()?.version;
    await client.close();

    expect(tools.map((tool) => tool.name).sort()).toEqual(allTools.map((tool) => tool.name).sort());
    expect(version).toBe(pkg.version);
  });
});

describe('configuration that users are asked for', () => {
  const declared = (config: Record<string, unknown>) => Object.keys(config);
  const referenced = (env: Record<string, string>) =>
    Object.values(env).flatMap((value) =>
      [...value.matchAll(/\$\{user_config\.([a-z_]+)\}/g)].map((match) => match[1]),
    );

  it('only references user_config keys that the Claude plugin declares', () => {
    const keys = referenced(claudePlugin.mcpServers.wassist.env);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(declared(claudePlugin.userConfig)).toContain(key);
  });

  it('only references user_config keys that the desktop extension declares', () => {
    const keys = referenced(mcpb.server.mcp_config.env);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(declared(mcpb.user_config)).toContain(key);
  });

  it('marks the API key as a secret everywhere it is asked for', () => {
    expect(claudePlugin.userConfig.api_key.sensitive).toBe(true);
    expect(mcpb.user_config.api_key.sensitive).toBe(true);
  });

  it('uses the environment variable names that the server reads', () => {
    const names = ['WASSIST_API_KEY', 'WASSIST_READ_ONLY'];
    expect(Object.keys(claudePlugin.mcpServers.wassist.env)).toEqual(names);
    expect(Object.keys(mcpb.server.mcp_config.env)).toEqual(names);
  });
});

describe('the bundled skill', () => {
  const skill = read('plugins/wassist/skills/wassist-agent-builder/SKILL.md');

  it('has front matter that matches its folder', () => {
    expect(skill).toMatch(/^---\nname: wassist-agent-builder\ndescription: .{40,}\n---\n/);
  });

  it('only mentions tools that exist', () => {
    const names = new Set(allTools.map((tool) => tool.name));
    const mentioned = [...skill.matchAll(/`(wassist_[a-z_]+)`/g)].map((match) => match[1]);

    expect(mentioned.length).toBeGreaterThan(10);
    for (const name of mentioned) expect(names, name).toContain(name);
  });

  it('covers every tool', () => {
    for (const tool of allTools) expect(skill, tool.name).toContain(`\`${tool.name}\``);
  });
});
