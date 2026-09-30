import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isReadOnly } from '../../src/mcp/tool.js';
import { allTools, selectTools, TOOLSET_NAMES } from '../../src/tools.js';

// The README is the first thing a reader sees, and its counts once disagreed with each other.
const readme = readFileSync(fileURLToPath(new URL('../../README.md', import.meta.url)), 'utf8');

describe('README', () => {
  it('lists every tool and states the right counts', () => {
    const reads = allTools.filter(isReadOnly).length;

    for (const tool of allTools) expect(readme, tool.name).toContain(`| \`${tool.name}\` |`);
    expect(readme).toContain(
      `The server has ${allTools.length} tools. ${reads} only read, and ${allTools.length - reads} change something.`,
    );
    expect(readme).toContain(`run the ${reads} read tools only`);
  });

  it('groups the tool tables by toolset, so each table is exactly what that toolset loads', () => {
    for (const name of TOOLSET_NAMES) {
      const section = readme.split(`(\`${name}\`)\n`)[1]?.split('\n### ')[0] ?? '';
      const listed = [...section.matchAll(/^\| `(wassist_[a-z_]+)` \|/gm)].map((match) => match[1]);
      const loaded = selectTools({ readOnly: false, toolsets: [name] })
        .map((tool) => tool.name)
        .filter((tool) => tool !== 'wassist_guide');

      expect(listed.sort(), name).toEqual(loaded.sort());
    }
  });
});
