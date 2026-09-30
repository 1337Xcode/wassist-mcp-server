import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { describe, expect, it } from 'vitest';
import { allTools } from '../../src/tools.js';

// The built stdio server, so the test runs the same file that gets published.
const entry = fileURLToPath(new URL('../../dist/bin/stdio.js', import.meta.url));

/** The current environment without any Wassist settings, plus `extra`. */
function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined),
  );
  delete env.WASSIST_API_KEY;
  delete env.WASSIST_READ_ONLY;
  return { ...env, ...extra };
}

/** Launches the server as a child process, connects over stdio and returns its tool names. */
async function listToolNames(env: Record<string, string>, modern = false): Promise<string[]> {
  const client = new Client(
    { name: 'tests', version: '0.0.0' },
    modern ? { versionNegotiation: { mode: 'auto' } } : {},
  );
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [entry], env, stderr: 'ignore' }),
  );
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((tool) => tool.name);
}

describe('stdio server process', () => {
  it('starts with a key and serves every tool over the protocol without stray stdout', async () => {
    const names = await listToolNames(cleanEnv({ WASSIST_API_KEY: 'test-key-0123456789abcdef' }));

    expect(names).toHaveLength(allTools.length);
    expect(names).toContain('wassist_send_text_message');
  });

  it('serves a client that negotiates the 2026-07-28 protocol revision', async () => {
    const names = await listToolNames(
      cleanEnv({ WASSIST_API_KEY: 'test-key-0123456789abcdef' }),
      true,
    );

    expect(names).toHaveLength(allTools.length);
  });

  it('serves only read tools when WASSIST_READ_ONLY is true', async () => {
    const names = await listToolNames(
      cleanEnv({ WASSIST_API_KEY: 'test-key-0123456789abcdef', WASSIST_READ_ONLY: 'true' }),
    );

    expect(names).toHaveLength(allTools.filter((tool) => tool.effect === 'read').length);
    expect(names).not.toContain('wassist_send_text_message');
  });

  it('exits with a clear message and empty stdout when the key is missing', () => {
    const result = spawnSync(process.execPath, [entry], {
      env: cleanEnv(),
      encoding: 'utf8',
      timeout: 10_000,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('WASSIST_API_KEY is not set');
  });

  it('rejects a key with spaces without echoing it', () => {
    const result = spawnSync(process.execPath, [entry], {
      env: cleanEnv({ WASSIST_API_KEY: 'super secret value' }),
      encoding: 'utf8',
      timeout: 10_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('WASSIST_API_KEY contains spaces');
    expect(result.stderr).not.toContain('super secret value');
  });

  it('rejects an invalid WASSIST_READ_ONLY value', () => {
    const result = spawnSync(process.execPath, [entry], {
      env: cleanEnv({ WASSIST_API_KEY: 'test-key-0123456789abcdef', WASSIST_READ_ONLY: 'yes' }),
      encoding: 'utf8',
      timeout: 10_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('WASSIST_READ_ONLY must be true or false');
  });
});
