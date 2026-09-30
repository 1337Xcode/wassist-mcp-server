import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('keeps docs/tools.md in sync with the tool definitions', () => {
  const script = fileURLToPath(new URL('../../scripts/generate-tool-docs.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });

  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});
