import { z } from 'zod';
import { textOrEmpty, textOrNull } from '../../wassist/fields.js';
import { apiPath, type WassistHttp } from '../../wassist/http.js';
import { fetchAll, type Page, type PageParams } from '../../wassist/list.js';

// The raw schema accepts what Wassist sends and tolerates null and missing fields.
// The exported schemas define what the tools return, and clients see them as the output schema.
const rawTemplate = z.object({
  id: z.string(),
  name: z.string(),
  category: textOrEmpty,
  language: textOrEmpty,
  parameterFormat: textOrNull,
  components: z
    .array(z.record(z.string(), z.unknown()))
    .nullish()
    .transform((components) => components ?? []),
  // One entry per WhatsApp Business Account the template was submitted to, with Meta's verdict.
  accountLinks: z
    .array(
      z.object({
        accountId: z.string(),
        accountName: textOrNull,
        status: textOrNull,
        rejectionReason: textOrNull,
      }),
    )
    .nullish()
    .transform((links) => links ?? []),
  // Only a publish response carries these. Wassist sends them as loose objects.
  publishErrors: z
    .array(z.record(z.string(), z.unknown()))
    .nullish()
    .transform((errors) =>
      (errors ?? []).map((entry) => ({
        accountId: typeof entry.accountId === 'string' ? entry.accountId : null,
        error: typeof entry.error === 'string' ? entry.error : null,
      })),
    ),
});

/** A message template and Meta's review status for it on each linked account. */
export const templateSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  language: z.string(),
  parameterFormat: z.string().nullable(),
  components: z.array(z.record(z.string(), z.unknown())),
  accountLinks: z.array(
    z.object({
      accountId: z.string(),
      accountName: z.string().nullable(),
      status: z.string().nullable(),
      rejectionReason: z.string().nullable(),
    }),
  ),
});

/** A template after publishing, with the accounts Wassist could not submit it to. */
export const publishedTemplateSchema = templateSchema.extend({
  publishErrors: z.array(
    z.object({ accountId: z.string().nullable(), error: z.string().nullable() }),
  ),
});

export type Template = z.infer<typeof templateSchema>;
export type PublishedTemplate = z.infer<typeof publishedTemplateSchema>;

/** Fields for a new template. Wassist keeps it as a draft until it is published. */
export interface TemplateDraft {
  name: string;
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  language?: string;
  parameterFormat?: 'POSITIONAL' | 'NAMED';
  components?: Record<string, unknown>[];
}

/** Any subset of a draft. Sending `components` replaces the whole list. */
export type TemplateChanges = Partial<TemplateDraft>;

/** Drops `publishErrors` from a response that is not a publish result. */
function withoutErrors({
  publishErrors: _ignored,
  ...template
}: z.output<typeof rawTemplate>): Template {
  return template;
}

/** Operations on /whatsapp-templates/. */
export function templatesApi(http: WassistHttp) {
  return {
    /** GET /whatsapp-templates/. Wassist ignores limit and offset here, so the page is cut locally. */
    async list(page: PageParams, signal?: AbortSignal): Promise<Page<Template>> {
      const result = await fetchAll(http, '/whatsapp-templates/', {}, rawTemplate, page, signal);
      return { ...result, items: result.items.map(withoutErrors) };
    },

    /** POST /whatsapp-templates/. Creates a draft. Nothing reaches Meta yet. */
    async create(draft: TemplateDraft, signal?: AbortSignal): Promise<Template> {
      const template = await http.request(
        { method: 'POST', path: '/whatsapp-templates/', body: draft },
        rawTemplate,
        signal,
      );
      return withoutErrors(template);
    },

    /** PATCH /whatsapp-templates/{id}/. Sends only the fields in `changes`. */
    async update(id: string, changes: TemplateChanges, signal?: AbortSignal): Promise<Template> {
      const template = await http.request(
        { method: 'PATCH', path: apiPath`/whatsapp-templates/${id}/`, body: changes },
        rawTemplate,
        signal,
      );
      return withoutErrors(template);
    },

    /** POST /whatsapp-templates/{id}/publish/. Submits the template to Meta for each account. */
    publish(id: string, accountIds: string[], signal?: AbortSignal): Promise<PublishedTemplate> {
      return http.request(
        { method: 'POST', path: apiPath`/whatsapp-templates/${id}/publish/`, body: { accountIds } },
        rawTemplate,
        signal,
      );
    },
  };
}
