import { z } from 'zod';
import { flag, nullable, reference, textOrNull } from '../../wassist/fields.js';
import { apiPath, type WassistHttp } from '../../wassist/http.js';
import { fetchAll, type Page, type PageParams } from '../../wassist/list.js';

// The raw schema accepts what Wassist sends and tolerates null and missing fields.
// The exported schema defines what the tools return, and clients see it as the output schema.
const rawPhoneNumber = z.object({
  id: z.string(),
  number: z.string(),
  isSandbox: flag,
  defaultRouting: textOrNull,
  activeAgent: nullable(reference),
  defaultWebhook: nullable(reference),
  whatsappBusinessAccount: nullable(z.object({ id: z.string(), name: textOrNull })),
});

/** A WhatsApp number and where its incoming messages go: an agent, a webhook, or nowhere. */
export const phoneNumberSchema = z.object({
  id: z.string(),
  number: z.string(),
  isSandbox: z.boolean(),
  defaultRouting: z.string().nullable(),
  activeAgent: z.object({ id: z.string(), name: z.string() }).nullable(),
  defaultWebhook: z.object({ id: z.string(), name: z.string() }).nullable(),
  whatsappBusinessAccount: z.object({ id: z.string(), name: z.string().nullable() }).nullable(),
});

export type PhoneNumber = z.infer<typeof phoneNumberSchema>;

/** How far a routing change reaches. */
export interface RoutingScope {
  /** Also rewrites the active agent on conversations that already exist on the number. */
  applyToExisting: boolean;
}

/** Wassist expects the number in E.164 form without the leading plus. */
function toPathNumber(number: string): string {
  return number.startsWith('+') ? number.slice(1) : number;
}

/** Operations on /phone-numbers/. */
export function phoneNumbersApi(http: WassistHttp) {
  return {
    /** GET /phone-numbers/. Wassist ignores limit and offset here, so the page is cut locally. */
    list(page: PageParams, signal?: AbortSignal): Promise<Page<PhoneNumber>> {
      return fetchAll(http, '/phone-numbers/', {}, rawPhoneNumber, page, signal);
    },

    /** POST /phone-numbers/{number}/connect-agent/. Replaces the number's routing at once. */
    connectAgent(
      number: string,
      agentId: string,
      scope: RoutingScope,
      signal?: AbortSignal,
    ): Promise<PhoneNumber> {
      return http.request(
        {
          method: 'POST',
          path: apiPath`/phone-numbers/${toPathNumber(number)}/connect-agent/`,
          body: { agentId, applyToExisting: scope.applyToExisting },
        },
        rawPhoneNumber,
        signal,
      );
    },

    /** POST /phone-numbers/{number}/unsubscribe/. Stops replies. Incoming messages are still stored. */
    clearRouting(number: string, scope: RoutingScope, signal?: AbortSignal): Promise<PhoneNumber> {
      return http.request(
        {
          method: 'POST',
          path: apiPath`/phone-numbers/${toPathNumber(number)}/unsubscribe/`,
          body: { applyToExisting: scope.applyToExisting },
        },
        rawPhoneNumber,
        signal,
      );
    },
  };
}
