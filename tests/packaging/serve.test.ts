import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const entry = fileURLToPath(new URL('../../scripts/serve.mjs', import.meta.url));

/** Finds a port nothing is using, so the spawned server can take it. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => resolve(port));
    });
  });
}

/** Runs serve.mjs until a line matches, then stops it and returns everything it printed. */
function serveUntil(match: RegExp, env: NodeJS.ProcessEnv, args: string[] = []) {
  return new Promise<string>((resolve, reject) => {
    const base = { ...process.env };
    delete base.PUBLIC_URL;
    delete base.BIND_ADDRESS;
    delete base.WASSIST_API_KEY;
    const child = spawn(process.execPath, [entry, ...args], {
      env: { ...base, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const done = (error?: Error, value?: string) => {
      clearTimeout(timer);
      child.kill();
      error ? reject(error) : resolve(value ?? out);
    };
    const timer = setTimeout(
      () => done(new Error(`serve.mjs did not print ${match} in time. Output:\n${out}`)),
      30_000,
    );
    const collect = (chunk: Buffer) => {
      out += chunk;
      if (match.test(out)) done(undefined, out);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => done(error));
    // 'close' fires after stdout and stderr have drained. 'exit' can fire before the last output
    // is read, which made this test fail at random when the child stopped quickly.
    child.on('close', (code) => done(new Error(`serve.mjs exited with ${code}. Output:\n${out}`)));
  });
}

describe('npm run serve', () => {
  it('prints the connector link and starts the server when given a public address', async () => {
    // Waits for the server's own ready line, so a server that fails to start fails the test.
    const out = await serveUntil(/ready on http/, { PORT: String(await freePort()) }, [
      'https://tunnel.example.com',
    ]);

    expect(out).toContain('https://tunnel.example.com/mcp');
    expect(out).toMatch(/server on (Windows|macOS|Linux)/);
    expect(out).not.toMatch(/wsm1|key[=:]/i);
  });

  it('prints the local link and tunnel hint without a public address', async () => {
    const port = await freePort();
    const out = await serveUntil(/your-tunnel-address/, { PORT: String(port) });

    expect(out).toContain(`http://localhost:${port}/mcp`);
    expect(out).toContain(`cloudflared tunnel --url http://localhost:${port}`);
  });

  it('rejects a public address with a path', async () => {
    await expect(
      serveUntil(/never/, { PORT: String(await freePort()) }, ['https://x.example.com/path']),
    ).rejects.toThrow(/https:\/\/ origin with no path/);
  });
});
