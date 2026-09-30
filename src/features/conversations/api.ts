import { z } from 'zod';
import {
  flag,
  nullable,
  numberOrZero,
  rawToolExecutions,
  reference,
  textOrEmpty,
  textOrNull,
  toolExecutionSchema,
  truncate,
} from '../../wassist/fields.js';
import { apiPath, type WassistHttp } from '../../wassist/http.js';
import { fetchPage, mapPage, type Page, type PageParams } from '../../wassist/list.js';

// Caps that keep one long customer message from flooding the model's context.
const PREVIEW_LENGTH = 200;
const MESSAGE_TEXT_LENGTH = 2000;

// The raw schemas accept what Wassist sends and tolerate null and missing fields.
// The exported schemas define what the tools return, and clients see them as the output schema.
const rawConversation = z.object({
  id: z.string(),
  contact: z.object({ name: textOrNull, phoneNumber: z.string() }),
  whatsappNumber: nullable(z.object({ number: z.string(), isSandbox: flag })),
  activeAgent: nullable(reference),
  // Seconds left in the 24-hour window. Wassist gives the number without a unit in its name.
  chatWindowRemainingTime: numberOrZero,
  active: flag,
  isHumanTakeover: flag,
  routing: textOrNull,
  lastMessage: nullable(
    z.object({ role: textOrEmpty, type: textOrEmpty, body: textOrEmpty, createdAt: textOrEmpty }),
  ),
});

/** A conversation between a business number and a customer, with the state a sender needs. */
export const conversationSchema = z.object({
  id: z.string(),
  contact: z.object({ name: z.string().nullable(), phoneNumber: z.string() }),
  whatsappNumber: z.object({ number: z.string(), isSandbox: z.boolean() }).nullable(),
  activeAgent: z.object({ id: z.string(), name: z.string() }).nullable(),
  chatWindowRemainingSeconds: z.number(),
  active: z.boolean(),
  isHumanTakeover: z.boolean(),
  routing: z.string().nullable(),
  lastMessage: z
    .object({ role: z.string(), type: z.string(), preview: z.string(), createdAt: z.string() })
    .nullable(),
});

export type Conversation = z.infer<typeof conversationSchema>;

// A message fills in one of these parts depending on its type. Each holds the text a reader sees.
const textPart = z.object({ body: textOrEmpty }).nullish();
const captionPart = z.object({ caption: textOrNull }).nullish();
const labelPart = z.object({ text: textOrEmpty }).nullish();

// Tool executions keep only the name, type, error and duration. Their arguments and results can
// hold customer data, so they are not parsed.
const rawMessage = z.object({
  id: z.string(),
  role: textOrEmpty,
  type: textOrEmpty,
  status: textOrNull,
  createdAt: textOrEmpty,
  source: textOrNull,
  text: textPart,
  unified: textPart,
  image: captionPart,
  cta: labelPart,
  listSelection: labelPart,
  quickReply: labelPart,
  template: z.object({ templateName: textOrEmpty }).nullish(),
  toolExecutions: rawToolExecutions,
});

/** One message as plain text, plus which tools the agent ran to produce it. */
export const messageSchema = z.object({
  id: z.string(),
  role: z.string(),
  type: z.string(),
  status: z.string().nullable(),
  createdAt: z.string(),
  source: z.string().nullable(),
  text: z.string().nullable(),
  toolExecutions: z.array(toolExecutionSchema),
});

export type Message = z.infer<typeof messageSchema>;

/** Filters for listing conversations. Each one is sent to Wassist, which applies it. */
export interface ConversationFilter {
  agentId?: string;
  whatsappNumber?: string;
  contact?: string;
  status?: 'active' | 'closed';
  ordering?: 'last_message_time' | '-last_message_time' | 'created_at' | '-created_at';
}

/** A template send: the template's name and the values for its placeholders. */
export interface TemplateMessage {
  name: string;
  variables?: {
    body?: string[] | Record<string, string>;
    header?: string[] | Record<string, string>;
    buttons?: string[];
  };
}

type RawConversation = z.output<typeof rawConversation>;
type RawMessage = z.output<typeof rawMessage>;

/** Renames the window field to say its unit and shortens the last message to a preview. */
function toConversation(conversation: RawConversation): Conversation {
  const { chatWindowRemainingTime, lastMessage, ...rest } = conversation;
  return {
    ...rest,
    chatWindowRemainingSeconds: chatWindowRemainingTime,
    lastMessage: lastMessage && {
      role: lastMessage.role,
      type: lastMessage.type,
      preview: truncate(lastMessage.body, PREVIEW_LENGTH),
      createdAt: lastMessage.createdAt,
    },
  };
}

/** Picks the readable text from whichever message part Wassist filled in. */
function messageText(message: RawMessage): string | null {
  const text =
    message.text?.body ||
    message.unified?.body ||
    message.cta?.text ||
    message.listSelection?.text ||
    message.quickReply?.text ||
    message.image?.caption ||
    (message.template ? `[template: ${message.template.templateName}]` : '');
  return text ? truncate(text, MESSAGE_TEXT_LENGTH) : null;
}

/** Flattens the message parts into one text field. */
function toMessage(message: RawMessage): Message {
  return {
    id: message.id,
    role: message.role,
    type: message.type,
    status: message.status,
    createdAt: message.createdAt,
    source: message.source,
    text: messageText(message),
    toolExecutions: message.toolExecutions,
  };
}

/** Operations on /conversations/ and the messages inside them. */
export function conversationsApi(http: WassistHttp) {
  /**
   * POSTs a message body to a conversation. The client never retries a POST, so a lost answer
   * surfaces as an unknown outcome and never as a second message to the customer.
   */
  const sendMessage = async (
    conversationId: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Message> => {
    const sent = await http.request(
      { method: 'POST', path: apiPath`/conversations/${conversationId}/messages/`, body },
      rawMessage,
      signal,
    );
    return toMessage(sent);
  };

  return {
    /** GET /conversations/. Wassist pages this endpoint and applies the filters itself. */
    async list(
      filter: ConversationFilter,
      page: PageParams,
      signal?: AbortSignal,
    ): Promise<Page<Conversation>> {
      const query = {
        agent: filter.agentId,
        whatsappNumber: filter.whatsappNumber,
        contact: filter.contact,
        status: filter.status,
        ordering: filter.ordering,
      };
      const result = await fetchPage(http, '/conversations/', query, rawConversation, page, signal);
      return mapPage(result, toConversation);
    },

    /** GET /conversations/{id}/. */
    async get(id: string, signal?: AbortSignal): Promise<Conversation> {
      const conversation = await http.request(
        { method: 'GET', path: apiPath`/conversations/${id}/` },
        rawConversation,
        signal,
      );
      return toConversation(conversation);
    },

    /** GET /conversations/{id}/messages/, newest first. Wassist pages this endpoint itself. */
    async listMessages(
      conversationId: string,
      page: PageParams,
      signal?: AbortSignal,
    ): Promise<Page<Message>> {
      const path = apiPath`/conversations/${conversationId}/messages/`;
      return mapPage(await fetchPage(http, path, {}, rawMessage, page, signal), toMessage);
    },

    /** Sends free-form text. Wassist accepts it only while the 24-hour window is open. */
    sendText(conversationId: string, text: string, signal?: AbortSignal): Promise<Message> {
      return sendMessage(conversationId, { type: 'unified', unified: { text } }, signal);
    },

    /** Sends an approved template. Unlike free-form text, it works when the window has closed. */
    sendTemplate(
      conversationId: string,
      template: TemplateMessage,
      signal?: AbortSignal,
    ): Promise<Message> {
      return sendMessage(conversationId, { type: 'template', template }, signal);
    },
  };
}
