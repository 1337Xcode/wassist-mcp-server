import type { z } from 'zod';
import type { WassistApi } from '../api.js';

/**
 * What a tool does to the outside world:
 * read only looks, create adds something new, update overwrites existing settings,
 * external acts on WhatsApp or Meta (sends a message, submits a template).
 */
export type ToolEffect = 'read' | 'create' | 'update' | 'external';

/** What a tool's `run` receives besides its input: the API to call and the request's cancel signal. */
interface ToolContext {
  api: WassistApi;
  signal: AbortSignal;
}

/** A plain JSON object. Tool results have to be one. */
type JsonObject = Record<string, unknown>;

/** A tool as the server registers it. Build one with `defineTool`. */
export interface Tool {
  name: string;
  title: string;
  description: string;
  effect: ToolEffect;
  input: z.ZodType;
  output: z.ZodType<JsonObject>;
  /** Extra guidance for a rejected request whose next step is known. */
  rejectionHint?: string;
  run(rawArgs: unknown, context: ToolContext): Promise<JsonObject>;
}

/** What `defineTool` takes. The input and output types flow into `run`. */
interface ToolSpec<I extends z.ZodType, O extends z.ZodType<JsonObject>> {
  name: `wassist_${string}`;
  title: string;
  description: string;
  effect: ToolEffect;
  input: I;
  output: O;
  rejectionHint?: string;
  run(args: z.output<I>, context: ToolContext): Promise<z.output<O>>;
}

/** Builds a tool whose `run` only ever receives input that its schema has already parsed. */
export function defineTool<I extends z.ZodType, O extends z.ZodType<JsonObject>>(
  spec: ToolSpec<I, O>,
): Tool {
  const { run, ...definition } = spec;
  return { ...definition, run: (rawArgs, context) => run(spec.input.parse(rawArgs), context) };
}

/** True for a tool that never changes anything. Read-only mode keeps only these. */
export const isReadOnly = (tool: Tool): boolean => tool.effect === 'read';

/** The MCP hint fields that clients use to decide when to ask for approval. */
interface Annotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/**
 * MCP annotations are hints for the client's approval prompts.
 * Read-only mode is what enforces anything.
 */
export const ANNOTATIONS: Record<ToolEffect, Annotations> = {
  read: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  create: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  update: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  external: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};
