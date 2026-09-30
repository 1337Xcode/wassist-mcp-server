import { agentsApi } from './features/agents/api.js';
import { capabilitiesApi } from './features/capabilities/api.js';
import { connectorsApi } from './features/connectors/api.js';
import { conversationsApi } from './features/conversations/api.js';
import { phoneNumbersApi } from './features/phone-numbers/api.js';
import { templatesApi } from './features/templates/api.js';
import { testChatsApi } from './features/test-chats/api.js';
import { testRunsApi } from './features/test-runs/api.js';
import { whatsappAccountsApi } from './features/whatsapp-accounts/api.js';
import type { WassistHttp } from './wassist/http.js';

/** Typed operations on the Wassist resources this server uses, all bound to one caller's key. */
export function createWassistApi(http: WassistHttp) {
  return {
    agents: agentsApi(http),
    capabilities: capabilitiesApi(http),
    connectors: connectorsApi(http),
    testChats: testChatsApi(http),
    testRuns: testRunsApi(http),
    phoneNumbers: phoneNumbersApi(http),
    conversations: conversationsApi(http),
    templates: templatesApi(http),
    whatsappAccounts: whatsappAccountsApi(http),
  };
}

/** The type of what `createWassistApi` returns. Every tool receives one. */
export type WassistApi = ReturnType<typeof createWassistApi>;
