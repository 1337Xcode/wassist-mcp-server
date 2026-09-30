import { z } from 'zod';

/** A UUID input whose description names what it identifies. Anything else is rejected before a request is built. */
export const idOf = (what: string) =>
  z.uuid().describe(`The ${what} ID, a UUID from the matching list tool.`);

/** Limit and offset for a list tool. `maxLimit` caps how much one call can pull. */
export const paging = (maxLimit: number) => ({
  limit: z
    .number()
    .int()
    .min(1)
    .max(maxLimit)
    .default(20)
    .describe(`Maximum items to return, 1 to ${maxLimit}.`),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Items to skip. Pass nextOffset from the previous page.'),
});

/** A phone number in E.164 form, with or without the leading plus. */
export const phoneNumber = z
  .string()
  .regex(/^\+?[1-9]\d{6,14}$/, 'Use E.164 format, for example +447700900100.')
  .describe('A phone number in E.164 format, for example +447700900100.');

/** The output shape of every list tool: the items, the total when known, and where the next page starts. */
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z
      .number()
      .nullable()
      .describe('Total items available, or null when Wassist does not report it.'),
    nextOffset: z
      .number()
      .nullable()
      .describe('Offset for the next page, or null on the last page.'),
  });
