#!/usr/bin/env node
// Writes the bundled server that the plugin runs, so installing the plugin needs no npm and no build.
// Run `npm run build:plugin` after changing anything in src. Pass --check to fail when the file is stale.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleServer } from './lib/bundle.mjs';

const target = fileURLToPath(new URL('../plugins/wassist/server/index.mjs', import.meta.url));
const bundle = await bundleServer();

if (process.argv.includes('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current !== bundle) {
    process.stderr.write(
      'plugins/wassist/server/index.mjs is out of date. Run `npm run build:plugin`.\n',
    );
    process.exit(1);
  }
  process.stdout.write('plugins/wassist/server/index.mjs is up to date.\n');
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bundle);
  process.stdout.write(`Wrote ${target}\n`);
}
