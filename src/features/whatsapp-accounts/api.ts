import { z } from 'zod';
import { textOrNull } from '../../wassist/fields.js';
import type { WassistHttp } from '../../wassist/http.js';
import { fetchAll, type Page, type PageParams } from '../../wassist/list.js';

// The raw schema accepts what Wassist sends and tolerates null and missing fields.
// The exported schema defines what the tool returns, and clients see it as the output schema.
const rawAccount = z.object({ id: z.string(), name: textOrNull, waId: z.string() });

/** A WhatsApp Business Account linked to the organization. Its id is what template publishing needs. */
export const whatsappAccountSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  waId: z.string(),
});

export type WhatsAppAccount = z.infer<typeof whatsappAccountSchema>;

// What Wassist returns for a link session. The link is what the tool hands to the user.
const rawLinkSession = z.object({
  id: z.string(),
  status: textOrNull,
  linkUrl: z.string(),
});

/** A pending link for connecting a real WhatsApp number. The user finishes it in their browser. */
export const linkSessionSchema = z.object({
  id: z.string(),
  status: z.string().nullable(),
  linkUrl: z.string(),
});

export type LinkSession = z.infer<typeof linkSessionSchema>;

/** Where Wassist sends the user after the link succeeds or is cancelled. */
export interface LinkRedirects {
  successUrl: string;
  returnUrl: string;
}

/** Operations on /whatsapp-accounts/. */
export function whatsappAccountsApi(http: WassistHttp) {
  return {
    /** GET /whatsapp-accounts/. Wassist ignores limit and offset here, so the page is cut locally. */
    list(page: PageParams, signal?: AbortSignal): Promise<Page<WhatsAppAccount>> {
      return fetchAll(http, '/whatsapp-accounts/', {}, rawAccount, page, signal);
    },

    /** POST /whatsapp-link-sessions/. Creates a pending link. Nothing changes until the user finishes it. */
    createLink(redirects: LinkRedirects, signal?: AbortSignal): Promise<LinkSession> {
      return http.request(
        { method: 'POST', path: '/whatsapp-link-sessions/', body: redirects },
        rawLinkSession,
        signal,
      );
    },
  };
}
