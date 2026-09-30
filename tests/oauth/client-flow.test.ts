import {
  Client,
  type OAuthClientProvider,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { allTools } from '../../src/tools.js';
import { FakeWassist, json } from '../helpers/fake-wassist.js';
import {
  authorizeUrl,
  CALLBACK,
  hiddenAuthorization,
  type OAuthApp,
  ORG_KEY,
  startOAuthApp,
  submitKey,
  wassistAcceptingOrgKey,
} from '../helpers/oauth.js';

// The provider's stored shapes, taken from its own interface so they cannot drift.
type Tokens = NonNullable<Awaited<ReturnType<OAuthClientProvider['tokens']>>>;
type DiscoveryState = Parameters<NonNullable<OAuthClientProvider['saveDiscoveryState']>>[0];
type ClientInfo = NonNullable<Awaited<ReturnType<OAuthClientProvider['clientInformation']>>>;

/** A client that keeps its credentials in memory and lets the test play the part of the browser. */
class MemoryProvider implements OAuthClientProvider {
  authorizationUrl: URL | undefined;
  savedTokens: Tokens | undefined;
  private info: ClientInfo | undefined;
  private verifier = '';
  private discovery: DiscoveryState | undefined;

  readonly redirectUrl = CALLBACK;
  readonly clientMetadata = {
    client_name: 'Test assistant',
    redirect_uris: [CALLBACK],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };

  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: ClientInfo) {
    this.info = info;
  }
  tokens() {
    return this.savedTokens;
  }
  saveTokens(tokens: Tokens) {
    this.savedTokens = tokens;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }
  saveDiscoveryState(state: DiscoveryState) {
    this.discovery = state;
  }
  discoveryState() {
    return this.discovery;
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
}

// The app under test, closed after each test.
let app: OAuthApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Connects with the SDK's own OAuth client, signs in through the consent page, and reconnects. */
async function signInWithSdkClient(fake: FakeWassist) {
  app = await startOAuthApp(fake);
  const provider = new MemoryProvider();
  const first = new StreamableHTTPClientTransport(app.mcpUrl, { authProvider: provider });
  await new Client({ name: 'oauth-test', version: '0.0.0' }).connect(first).catch(() => undefined);
  if (!provider.authorizationUrl) throw new Error('The client never asked the user to sign in.');

  const page = await fetch(provider.authorizationUrl);
  const response = await submitKey(app.origin, hiddenAuthorization(await page.text()), ORG_KEY);
  await first.finishAuth(new URL(response.headers.get('location') ?? '').searchParams);
  return provider;
}

/** Connects with the stored credentials and no new sign-in. */
async function connect(provider: MemoryProvider) {
  if (!app) throw new Error('The app is not running.');
  const client = new Client({ name: 'oauth-test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(app.mcpUrl, { authProvider: provider }));
  return client;
}

describe('the MCP SDK client signing in through OAuth', () => {
  it('discovers, registers, authorizes with PKCE and then calls tools with the org key', async () => {
    const fake = wassistAcceptingOrgKey();
    const provider = await signInWithSdkClient(fake);
    fake.requests.length = 0;

    const client = await connect(provider);
    const { tools } = await client.listTools();
    const result = await client.callTool({ name: 'wassist_list_agents', arguments: {} });
    await client.close();

    expect(provider.authorizationUrl?.searchParams.get('code_challenge_method')).toBe('S256');
    expect(provider.authorizationUrl?.searchParams.get('resource')).toBe(app?.mcpUrl.href);
    expect(provider.savedTokens?.access_token).toMatch(/^wsm1\./);
    expect(tools).toHaveLength(allTools.length);
    expect(result.isError).not.toBe(true);
    expect(fake.requests.map((request) => request.headers.get('x-api-key'))).toEqual([ORG_KEY]);
  });

  it('refreshes by itself when the access token stops working', async () => {
    const provider = await signInWithSdkClient(wassistAcceptingOrgKey());
    const before = provider.savedTokens;
    provider.savedTokens = before && { ...before, access_token: 'wsm1.expired.access.token' };

    const client = await connect(provider);
    const { tools } = await client.listTools();
    await client.close();

    expect(tools).toHaveLength(allTools.length);
    expect(provider.savedTokens?.access_token).toMatch(/^wsm1\./);
    expect(provider.savedTokens?.access_token).not.toBe('wsm1.expired.access.token');
  });

  it('does not sign in when Wassist rejects the key', async () => {
    app = await startOAuthApp(new FakeWassist().on('GET', '/api/v1/agents/', json({}, 401)));
    const provider = new MemoryProvider();
    await new Client({ name: 'oauth-test', version: '0.0.0' })
      .connect(new StreamableHTTPClientTransport(app.mcpUrl, { authProvider: provider }))
      .catch(() => undefined);
    if (!provider.authorizationUrl) throw new Error('The client never asked the user to sign in.');

    const page = await fetch(
      authorizeUrl(app.origin, Object.fromEntries(provider.authorizationUrl.searchParams)),
    );
    const response = await submitKey(app.origin, hiddenAuthorization(await page.text()), ORG_KEY);

    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
  });
});
