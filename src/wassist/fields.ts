import { z } from 'zod';

/** Upstream fields are often null or missing, so these normalize them at the boundary. */
export const textOrEmpty = z
  .string()
  .nullish()
  .transform((value) => value ?? '');

/** Text, with a missing value turned into null. */
export const textOrNull = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

/** A boolean, with a missing value turned into false. */
export const flag = z
  .boolean()
  .nullish()
  .transform((value) => value ?? false);

/** A number, with a missing value turned into 0. */
export const numberOrZero = z
  .number()
  .nullish()
  .transform((value) => value ?? 0);

/** How many items an array has. Used when only the count is safe to show. */
export const countOf = z
  .array(z.unknown())
  .nullish()
  .transform((items) => items?.length ?? 0);

/** Wraps a schema so that a missing value becomes null. */
export const nullable = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);

/** A pointer to another resource: its id and name. */
export const reference = z.object({ id: z.string(), name: textOrEmpty });

/** Cuts text to `maxLength` characters and marks the cut with three dots. */
export function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

/**
 * The tools an agent ran, as conversation messages and test runs report them. Only the name,
 * type, error and duration are kept. Arguments and results are never parsed, because they can
 * hold customer data.
 */
export const rawToolExecutions = z
  .array(
    z.object({
      toolName: textOrEmpty,
      toolType: textOrNull,
      error: textOrNull,
      durationMs: z.number().nullish(),
    }),
  )
  .nullish()
  .transform((runs) =>
    (runs ?? []).map((run) => ({
      toolName: run.toolName,
      toolType: run.toolType,
      // Wassist sends an empty string when a tool succeeded.
      error: run.error || null,
      durationMs: run.durationMs ?? null,
    })),
  );

/** One tool run as the tools return it. */
export const toolExecutionSchema = z.object({
  toolName: z.string(),
  toolType: z.string().nullable(),
  error: z.string().nullable().describe('Null when the tool succeeded.'),
  durationMs: z.number().nullable(),
});
