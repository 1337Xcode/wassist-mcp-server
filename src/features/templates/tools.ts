import { z } from 'zod';
import { idOf, pageOf, paging } from '../../mcp/inputs.js';
import { defineTool } from '../../mcp/tool.js';
import { publishedTemplateSchema, templateSchema } from './api.js';

/** One template component. `example` and `buttons` keep Meta's own shapes and pass through. */
const component = z.strictObject({
  type: z.enum(['HEADER', 'BODY', 'FOOTER', 'BUTTONS']),
  format: z
    .enum(['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'])
    .optional()
    .describe('Header format. Only used by HEADER components.'),
  text: z
    .string()
    .max(1024)
    .optional()
    .describe('Component text. Placeholders are {{1}} or {{name}} depending on parameterFormat.'),
  example: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Example values Meta needs to review placeholders.'),
  buttons: z
    .array(z.record(z.string(), z.unknown()))
    .max(10)
    .optional()
    .describe('Button definitions for a BUTTONS component.'),
});

/** The component list. Sending it on an update replaces the whole list. */
const components = z
  .array(component)
  .max(10)
  .describe('The template components. When updating, this replaces the whole list.');

/** Field definitions shared by create and update, so both describe them the same way. */
const fields = {
  name: z.string().min(1).max(512).describe('Template name.'),
  category: z
    .enum(['UTILITY', 'MARKETING', 'AUTHENTICATION'])
    .describe('The WhatsApp template category.'),
  language: z
    .string()
    .min(2)
    .max(10)
    .describe('Language code such as en or en_GB. Wassist defaults to en.'),
  parameterFormat: z
    .enum(['POSITIONAL', 'NAMED'])
    .describe('POSITIONAL uses {{1}}, NAMED uses {{first_name}}.'),
  components,
};

/** Lists templates with Meta's review status per account. Wassist returns them whole, so paging is local. */
const listTemplates = defineTool({
  name: 'wassist_list_templates',
  title: 'List templates',
  description:
    'List your WhatsApp message templates with their components and the review status on each WhatsApp Business Account (accountLinks). A template can only be sent once its status is APPROVED.',
  effect: 'read',
  input: z.strictObject({ ...paging(50) }),
  output: pageOf(templateSchema),
  run: (args, { api, signal }) => api.templates.list(args, signal),
});

/** Creates a draft template. Nothing reaches Meta until it is published. */
const createTemplate = defineTool({
  name: 'wassist_create_template',
  title: 'Create template',
  description:
    'Create a message template as a draft in Wassist. Nothing is sent to Meta until you call wassist_publish_template, so a draft can still be changed with wassist_update_template.',
  effect: 'create',
  input: z.strictObject({
    name: fields.name,
    category: fields.category,
    language: fields.language.optional(),
    parameterFormat: fields.parameterFormat.optional(),
    components: fields.components.optional(),
  }),
  output: templateSchema,
  run: (draft, { api, signal }) => api.templates.create(draft, signal),
});

/** Edits a draft template. It needs at least one field and does not resubmit anything to Meta. */
const updateTemplate = defineTool({
  name: 'wassist_update_template',
  title: 'Update template',
  description:
    'Change a template in Wassist. Only the fields you pass change, and components replaces the whole list, so read the current template with wassist_list_templates first. This does not resubmit anything to Meta.',
  effect: 'update',
  input: z
    .strictObject({
      templateId: idOf('template'),
      name: fields.name.optional(),
      category: fields.category.optional(),
      language: fields.language.optional(),
      parameterFormat: fields.parameterFormat.optional(),
      components: fields.components.optional(),
    })
    .refine(
      ({ templateId: _templateId, ...changes }) =>
        Object.values(changes).some((value) => value !== undefined),
      {
        message: 'Pass at least one field to change.',
      },
    ),
  output: templateSchema,
  run: ({ templateId, ...changes }, { api, signal }) =>
    api.templates.update(templateId, changes, signal),
});

/** Submits a template to Meta for review on one or more accounts. This is the step that leaves Wassist. */
const publishTemplate = defineTool({
  name: 'wassist_publish_template',
  title: 'Publish template',
  description:
    'Submit a template to Meta for review on one or more WhatsApp Business Accounts. Meta then approves or rejects it, which can take some time, and the result shows up in accountLinks. Accounts that failed are listed in publishErrors. Get account IDs from wassist_list_whatsapp_accounts.',
  effect: 'external',
  input: z.strictObject({
    templateId: idOf('template'),
    accountIds: z
      .array(idOf('WhatsApp account'))
      .min(1)
      .max(20)
      .describe('WhatsApp Business Account IDs to publish to.'),
  }),
  output: publishedTemplateSchema,
  run: ({ templateId, accountIds }, { api, signal }) =>
    api.templates.publish(templateId, accountIds, signal),
});

/** Every template tool, in the order clients list them. */
export const templateTools = [listTemplates, createTemplate, updateTemplate, publishTemplate];
