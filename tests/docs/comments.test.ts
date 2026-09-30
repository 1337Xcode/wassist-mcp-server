import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// The folder whose declarations must be documented.
const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

// A top-level function, class, const, interface, type or enum.
const DECLARATION =
  /^(export\s+)?(default\s+)?(async\s+)?(function|const|let|class|interface|type|enum)\s+(\w+)/;
// A type that only restates a schema next to it needs no comment of its own.
const DERIVED_TYPE = /^(export\s+)?type\s+\w+\s*=\s*z\.(infer|output)</;

// A comment ends with */ or starts with //.
const isComment = (line: string) => line.endsWith('*/') || line.startsWith('//');

/** Finds top-level declarations with no comment above them. A comment also covers directly following one-line declarations. */
function undocumented(file: string): string[] {
  const lines = readFileSync(srcDir + file, 'utf8').split(/\r?\n/);
  const covered = new Set<number>();
  const missing: string[] = [];

  lines.forEach((line, index) => {
    const match = DECLARATION.exec(line);
    if (!match || DERIVED_TYPE.test(line)) return;

    let previous = index - 1;
    while (previous >= 0 && lines[previous]?.trim() === '') previous--;
    const above = lines[previous]?.trim() ?? '';
    const adjacent = previous === index - 1 && covered.has(previous);

    if (isComment(above) || adjacent) covered.add(index);
    else missing.push(`${file}:${index + 1} ${match[5]}`);
  });
  return missing;
}

it('has a comment above every top-level declaration in src', () => {
  const files = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => file.endsWith('.ts'));

  expect(files.length).toBeGreaterThan(20);
  expect(files.flatMap(undocumented)).toEqual([]);
});
