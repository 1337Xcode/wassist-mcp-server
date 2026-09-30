// Bundles the compiled stdio server into one self-contained file, which needs no npm install to run.
// Both the Claude Desktop extension and the plugin folder ship this file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Resolves a path relative to the repository root.
const fromRoot = (relative) => fileURLToPath(new URL(`../../${relative}`, import.meta.url));

// A single file has no package.json beside it, so the version is written into the bundle instead.
const inlineVersion = {
  name: 'inline-version',
  setup(esbuild) {
    const { version } = JSON.parse(readFileSync(fromRoot('package.json'), 'utf8'));
    esbuild.onLoad({ filter: /dist[\\/]version\.js$/ }, () => ({
      contents: `export const VERSION = ${JSON.stringify(version)};`,
    }));
  },
};

/**
 * Builds the bundle in memory and returns its text. Minified, so the output does not depend on
 * the machine's paths and can be compared byte for byte in a test.
 */
export async function bundleServer() {
  const result = await build({
    entryPoints: [fromRoot('dist/bin/stdio.js')],
    write: false,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    minify: true,
    legalComments: 'none',
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
    plugins: [inlineVersion],
    logLevel: 'warning',
  });
  return result.outputFiles[0].text;
}
