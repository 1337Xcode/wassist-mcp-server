#!/usr/bin/env node
// Rebuilds tests/fixtures/wassist-openapi.json from the official OpenAPI file.
// The contract test reads that fixture, so it needs no network and no local copy of the docs.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

// The official OpenAPI file that Wassist publishes.
const SOURCE = 'https://docs.wassist.app/api-reference/openapi.json';
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const target = new URL('../tests/fixtures/wassist-openapi.json', import.meta.url);

const response = await fetch(SOURCE);
if (!response.ok) {
  process.stderr.write(`Could not download ${SOURCE}: HTTP ${response.status}\n`);
  process.exit(1);
}
const text = await response.text();
const spec = JSON.parse(text);

// Follows a $ref to the schema it names.
function resolve(schema) {
  if (!schema.$ref) return schema;
  const name = schema.$ref.split('/').pop();
  const resolved = spec.components?.schemas?.[name];
  if (!resolved) throw new Error(`Unresolved reference ${schema.$ref}`);
  return resolved;
}

const operations = {};
for (const path of Object.keys(spec.paths).sort()) {
  for (const method of HTTP_METHODS) {
    const operation = spec.paths[path][method];
    if (!operation) continue;
    const schema = operation.requestBody?.content?.['application/json']?.schema;
    const properties = schema ? Object.keys(resolve(schema).properties ?? {}).sort() : [];
    operations[`${method.toUpperCase()} ${path}`] = properties;
  }
}

const fixture = {
  source: SOURCE,
  sha256: createHash('sha256').update(text).digest('hex'),
  retrievedAt: new Date().toISOString().slice(0, 10),
  operations,
};
writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`);
process.stdout.write(
  `Wrote ${Object.keys(operations).length} operations. Run npm run format next.\n`,
);
