import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { TOOLSET_NAMES, type ToolSelection } from './tools.js';
import { isValidApiKey } from './wassist/http.js';

/** A problem with the environment. The entry points print its message and exit with status 1. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Settings for the stdio entry point. */
export interface StdioConfig {
  apiKey: string;
  tools: ToolSelection;
}

/** Settings for the optional sign-in page. */
interface OAuthConfig {
  /** Origin that clients use to reach this server, such as https://mcp.example.com. */
  publicUrl: string;
  secret: string;
  /** True when the secret was generated at startup, so every sign-in ends when the process restarts. */
  secretIsEphemeral: boolean;
  /** Hostnames that may receive sign-in codes over https. Empty means any host. */
  redirectHosts: string[];
}

/** Settings for the HTTP entry point. */
export interface HttpConfig {
  port: number;
  bindAddress: string;
  /** Extra Host header names to accept besides loopback, for example a tunnel or proxy domain. */
  allowedHosts: string[];
  /** Set when PUBLIC_URL is given. Turns on the OAuth sign-in for clients that cannot send a key. */
  oauth?: OAuthConfig;
  tools: ToolSelection;
  rateLimitPerMinute: number;
  maxBodyBytes: number;
}

/** A bare hostname such as mcp.example.com or [::1]. Schemes, ports and paths are rejected. */
const hostname = z
  .string()
  .toLowerCase()
  .regex(
    /^([a-z0-9-]+(\.[a-z0-9-]+)*|\[[0-9a-f:]+\])$/,
    'must be a bare hostname without scheme, port or path',
  );

/** A comma-separated environment value, split into trimmed entries that each match `schema`. */
const list = <T extends z.ZodType<string, string>>(schema: T) =>
  z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    )
    .pipe(z.array(schema));

// Templated environments often pass an unset option as an empty string, so treat it as missing.
const emptyAsUndefined = (value: unknown) => (value === '' ? undefined : value);

/** The read-only switch. It accepts true or false, and an empty value counts as false. */
const readOnly = z.preprocess(
  emptyAsUndefined,
  z
    .enum(['true', 'false'], { error: 'must be true or false' })
    .default('false')
    .transform((value) => value === 'true'),
);

/** WASSIST_TOOLSETS: the toolsets to load. Empty or unset loads all of them. */
const toolsets = list(
  z.enum(TOOLSET_NAMES, { error: `must list toolsets from ${TOOLSET_NAMES.join(', ')}` }),
).transform((names) => (names.length === 0 ? [...TOOLSET_NAMES] : [...new Set(names)]));

/** Hostnames that mean this machine. Plain http is only accepted for these. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** True for an https origin, or an http one on localhost, with no path, query or credentials. */
function isPublicOrigin(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
  return secure && url.pathname === '/' && !url.search && !url.hash && !url.username;
}

/** PUBLIC_URL, reduced to its origin. Setting it turns the sign-in page on. */
const publicUrl = z.preprocess(
  emptyAsUndefined,
  z
    .string()
    .refine(isPublicOrigin, {
      error: 'must be an https origin without a path, such as https://mcp.example.com',
    })
    .transform((value) => new URL(value).origin)
    .optional(),
);

/** OAUTH_SECRET, the key material for sealing tokens. A value under 32 characters is rejected. */
const oauthSecret = z.preprocess(
  emptyAsUndefined,
  z.string().min(32, { error: 'must be at least 32 characters' }).max(512).optional(),
);

/**
 * The variables the stdio entry point reads. One-click installs ship an empty key for the person
 * to fill in, so an empty key gets the same how-to message as a missing one.
 */
const stdioEnv = z.object({
  WASSIST_API_KEY: z.preprocess(
    emptyAsUndefined,
    z
      .string({
        error:
          'is not set. Create a key at https://wassist.app/settings/developers/api-keys/ and pass it in your MCP client configuration',
      })
      .refine(isValidApiKey, { error: 'contains spaces or unsupported characters' }),
  ),
  WASSIST_READ_ONLY: readOnly,
  WASSIST_TOOLSETS: toolsets,
});

/** The variables the HTTP entry point reads. A secret without a public URL is an error. */
const httpEnv = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
    BIND_ADDRESS: z.string().min(1).default('127.0.0.1'),
    ALLOWED_HOSTS: list(hostname),
    PUBLIC_URL: publicUrl,
    OAUTH_SECRET: oauthSecret,
    OAUTH_REDIRECT_HOSTS: list(hostname),
    WASSIST_READ_ONLY: readOnly,
    WASSIST_TOOLSETS: toolsets,
  })
  .refine((env) => env.OAUTH_SECRET === undefined || env.PUBLIC_URL !== undefined, {
    path: ['OAUTH_SECRET'],
    error: 'requires PUBLIC_URL',
  })
  .refine((env) => env.OAUTH_REDIRECT_HOSTS.length === 0 || env.PUBLIC_URL !== undefined, {
    path: ['OAUTH_REDIRECT_HOSTS'],
    error: 'requires PUBLIC_URL',
  });

/** Parses the environment and names every problem without echoing any value. */
function parseEnv<T extends z.ZodType>(schema: T, env: NodeJS.ProcessEnv): z.output<T> {
  const result = schema.safeParse(env);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`);
  throw new ConfigError(problems.join('; '));
}

/** Configuration for the stdio entry point, which serves one key for the whole process. */
export function loadStdioConfig(env: NodeJS.ProcessEnv): StdioConfig {
  const parsed = parseEnv(stdioEnv, env);
  return {
    apiKey: parsed.WASSIST_API_KEY,
    tools: { readOnly: parsed.WASSIST_READ_ONLY, toolsets: parsed.WASSIST_TOOLSETS },
  };
}

/** Configuration for the HTTP entry point. It reads no key, because each request brings its own. */
export function loadHttpConfig(env: NodeJS.ProcessEnv): HttpConfig {
  const parsed = parseEnv(httpEnv, env);
  const publicHost = parsed.PUBLIC_URL === undefined ? [] : [new URL(parsed.PUBLIC_URL).hostname];
  return {
    port: parsed.PORT,
    bindAddress: parsed.BIND_ADDRESS,
    allowedHosts: [...new Set([...parsed.ALLOWED_HOSTS, ...publicHost])],
    oauth:
      parsed.PUBLIC_URL === undefined
        ? undefined
        : {
            publicUrl: parsed.PUBLIC_URL,
            secret: parsed.OAUTH_SECRET ?? randomBytes(32).toString('base64url'),
            secretIsEphemeral: parsed.OAUTH_SECRET === undefined,
            redirectHosts: parsed.OAUTH_REDIRECT_HOSTS,
          },
    tools: { readOnly: parsed.WASSIST_READ_ONLY, toolsets: parsed.WASSIST_TOOLSETS },
    rateLimitPerMinute: 120,
    maxBodyBytes: 1024 * 1024,
  };
}
