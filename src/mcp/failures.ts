import { ZodError } from 'zod';
import { logger } from '../logger.js';
import { WassistApiError } from '../wassist/errors.js';
import type { Tool } from './tool.js';

/** What a failed tool call shows the model. Only fields this server chose are in it. */
interface Failure {
  code: string;
  message: string;
  status?: number;
  requestId?: string;
  retryAfterSeconds?: number;
  outcomeUnknown?: boolean;
}

/**
 * A failure a tool found itself before or after calling Wassist, such as an id that is not on
 * the agent. Its message goes to the model as written, so it must never hold customer data.
 */
export class ToolError extends Error {
  constructor(
    readonly code: 'invalid_input' | 'not_found' | 'conflict',
    message: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

/** Advice for a write whose result is uncertain. Retrying could send or change something twice. */
const UNKNOWN_OUTCOME =
  'The request may or may not have been applied. Check the current state with a read tool before trying again.';

/** Next-step advice added to the message of a known failure. */
function hintFor(tool: Tool, error: WassistApiError): string | undefined {
  if (error.details.outcomeUnknown) return UNKNOWN_OUTCOME;
  switch (error.kind) {
    case 'unauthorized':
      return 'Check the Wassist API key this server was given.';
    case 'forbidden':
      return 'The API key is valid but does not have permission for this action.';
    case 'not_found':
      return 'Check the ID with the matching list tool.';
    case 'rate_limited':
      return error.details.retryAfterSeconds === undefined
        ? 'Wait a minute and try again.'
        : `Wait ${error.details.retryAfterSeconds} seconds and try again.`;
    case 'invalid_request':
      return tool.rejectionHint;
    case 'timeout':
    case 'network_error':
      return 'Try again in a moment.';
    default:
      return undefined;
  }
}

/** Turns any thrown error into a `Failure`, and keeps the details of unexpected errors out of it. */
function describe(tool: Tool, error: unknown): Failure {
  if (error instanceof WassistApiError) {
    const hint = hintFor(tool, error);
    const { status, requestId, retryAfterSeconds, outcomeUnknown } = error.details;
    return {
      code: error.kind,
      message: hint ? `${error.message} ${hint}` : error.message,
      status,
      requestId,
      retryAfterSeconds,
      ...(outcomeUnknown && { outcomeUnknown }),
    };
  }
  if (error instanceof ToolError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof ZodError) {
    return { code: 'invalid_input', message: 'The arguments did not match the tool schema.' };
  }
  return {
    code: 'internal_error',
    message: 'The tool failed unexpectedly. The server log has the details.',
  };
}

/**
 * Builds the tool result the model sees. Only fields this server chose are included,
 * never a raw upstream body.
 */
export function failureResult(tool: Tool, error: unknown) {
  const failure = describe(tool, error);
  logger.warn('tool failed', {
    tool: tool.name,
    code: failure.code,
    status: failure.status,
    requestId: failure.requestId,
    ...(failure.code === 'internal_error' && {
      error: error instanceof Error ? error.message : String(error),
    }),
  });
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: failure }) }],
  };
}
