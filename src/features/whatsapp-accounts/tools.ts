import { z } from 'zod';
import { pageOf, paging } from '../../mcp/inputs.js';
import { defineTool } from '../../mcp/tool.js';
import { linkSessionSchema, whatsappAccountSchema } from './api.js';

/** Lists linked WhatsApp Business Accounts. Their ids are what template publishing needs. Read only. */
const listWhatsappAccounts = defineTool({
  name: 'wassist_list_whatsapp_accounts',
  title: 'List WhatsApp accounts',
  description:
    'List the WhatsApp Business Accounts linked to your organization. You need an account ID to publish a template with wassist_publish_template.',
  effect: 'read',
  input: z.strictObject({ ...paging(50) }),
  output: pageOf(whatsappAccountSchema),
  run: (args, { api, signal }) => api.whatsappAccounts.list(args, signal),
});

/** Where the user lands after linking when the caller does not say. */
const DEFAULT_REDIRECT = 'https://wassist.app/';

/** An https address, so the user is never sent to an insecure page after signing in with Meta. */
const redirectUrl = (description: string) =>
  z
    .url({ protocol: /^https$/ })
    .default(DEFAULT_REDIRECT)
    .describe(description);

/**
 * Creates the link a person opens to connect a real WhatsApp number. The Meta sign-in inside it can
 * only be completed by the person, so the tool hands over the link and does nothing else.
 */
const createWhatsappLink = defineTool({
  name: 'wassist_create_whatsapp_link',
  title: 'Create WhatsApp link',
  description:
    'Create a link for connecting a real WhatsApp Business number to Wassist. Give the link to the user. They open it and sign in with Meta in their browser, which only they can do. When they are done the number appears in wassist_list_phone_numbers, and you can connect an agent to it with wassist_connect_agent_to_number. The link expires if it is not used.',
  effect: 'create',
  input: z.strictObject({
    successUrl: redirectUrl('Where to send the user after the number is linked.'),
    returnUrl: redirectUrl('Where to send the user if they cancel or it fails.'),
  }),
  output: linkSessionSchema,
  run: (args, { api, signal }) => api.whatsappAccounts.createLink(args, signal),
});

/** Every WhatsApp account tool, in the order clients list them. */
export const whatsappAccountTools = [listWhatsappAccounts, createWhatsappLink];
