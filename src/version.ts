import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** The one field of package.json this file needs. */
const manifest = z.object({ version: z.string() });

// Read from package.json so the reported version cannot drift from the published one.
export const VERSION = manifest.parse(
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')),
).version;
