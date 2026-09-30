import { agentTools } from './features/agents/tools.js';
import { capabilityTools } from './features/capabilities/tools.js';
import { connectorTools } from './features/connectors/tools.js';
import { conversationTools } from './features/conversations/tools.js';
import { guideTools } from './features/guides/tools.js';
import { phoneNumberTools } from './features/phone-numbers/tools.js';
import { templateTools } from './features/templates/tools.js';
import { testChatTools } from './features/test-chats/tools.js';
import { testRunTools } from './features/test-runs/tools.js';
import { whatsappAccountTools } from './features/whatsapp-accounts/tools.js';
import { isReadOnly, type Tool } from './mcp/tool.js';

/** The toolset names `WASSIST_TOOLSETS` accepts, in the order the tools are listed. */
export const TOOLSET_NAMES = ['agents', 'testing', 'whatsapp', 'conversations'] as const;

/** One group of tools that a deployment can switch on or leave out. */
export type ToolsetName = (typeof TOOLSET_NAMES)[number];

/**
 * The tools in each toolset. Each tool belongs to exactly one, so a toolset can be left out
 * without breaking another. The groups follow the jobs people do: build agents, test them, set up
 * WhatsApp numbers and templates, and work with customer conversations.
 */
const TOOLSETS: Record<ToolsetName, readonly Tool[]> = {
  agents: [...agentTools, ...capabilityTools, ...connectorTools],
  testing: [...testChatTools, ...testRunTools],
  whatsapp: [...phoneNumberTools, ...whatsappAccountTools, ...templateTools],
  conversations: conversationTools,
};

/**
 * Every tool the server can expose. The order is stable so clients can cache the tool list and
 * keep prompt caches warm. The guide belongs to no toolset and is always on.
 */
export const allTools: readonly Tool[] = [
  ...TOOLSET_NAMES.flatMap((name) => TOOLSETS[name]),
  ...guideTools,
];

/** Which tools a deployment exposes. */
export interface ToolSelection {
  /** Leaves out every tool that changes anything. */
  readOnly: boolean;
  /** The toolsets to include. */
  toolsets: readonly ToolsetName[];
}

/**
 * The tools to register for a deployment, in the stable order of `allTools`. Tools left out are
 * never registered, so a client can neither list nor call them.
 */
export function selectTools({ readOnly, toolsets }: ToolSelection): Tool[] {
  const chosen = new Set([...toolsets.flatMap((name) => TOOLSETS[name]), ...guideTools]);
  return allTools.filter((tool) => chosen.has(tool) && (!readOnly || isReadOnly(tool)));
}
