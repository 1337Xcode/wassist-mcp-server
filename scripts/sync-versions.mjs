#!/usr/bin/env node
// Copies the version in package.json into every manifest that repeats it, so a release changes one number.
// Run `npm run version:sync` after bumping the version. A test fails when the files disagree.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Resolves a path relative to the repository root.
const at = (relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));
const readJson = (relative) => JSON.parse(readFileSync(at(relative), 'utf8'));
const { version } = readJson('package.json');

// Each manifest that repeats the version, with how to set it.
const manifests = {
  'plugins/wassist/plugin.json': (json) => {
    json.version = version;
  },
  'plugins/wassist/.claude-plugin/plugin.json': (json) => {
    json.version = version;
  },
  'gemini-extension.json': (json) => {
    json.version = version;
  },
  '.claude-plugin/marketplace.json': (json) => {
    json.metadata.version = version;
    for (const plugin of json.plugins) plugin.version = version;
  },
};

for (const [file, update] of Object.entries(manifests)) {
  const json = readJson(file);
  update(json);
  writeFileSync(at(file), `${JSON.stringify(json, null, 2)}\n`);
}
process.stdout.write(`Set version ${version} in ${Object.keys(manifests).length} manifests.\n`);
