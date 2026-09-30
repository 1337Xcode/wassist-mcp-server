import { describe, expect, it } from 'vitest';
import { ConfigError, loadHttpConfig, loadStdioConfig } from '../src/config.js';

// A valid OAUTH_SECRET: 32 or more characters.
const SECRET = 'config-test-secret-0123456789abcdef012345';

describe('loadStdioConfig', () => {
  it('reads the key and defaults to every tool, read and write', () => {
    expect(loadStdioConfig({ WASSIST_API_KEY: 'key-0123456789' })).toEqual({
      apiKey: 'key-0123456789',
      tools: { readOnly: false, toolsets: ['agents', 'testing', 'whatsapp', 'conversations'] },
    });
  });

  it('loads only the toolsets named in WASSIST_TOOLSETS, once each', () => {
    const config = loadStdioConfig({
      WASSIST_API_KEY: 'key-0123456789',
      WASSIST_TOOLSETS: ' agents, testing,agents ',
    });

    expect(config.tools.toolsets).toEqual(['agents', 'testing']);
  });

  it('treats an empty WASSIST_TOOLSETS as all toolsets and rejects unknown names', () => {
    const env = { WASSIST_API_KEY: 'key-0123456789' };

    expect(loadStdioConfig({ ...env, WASSIST_TOOLSETS: '' }).tools.toolsets).toEqual([
      'agents',
      'testing',
      'whatsapp',
      'conversations',
    ]);
    expect(() => loadStdioConfig({ ...env, WASSIST_TOOLSETS: 'agents,billing' })).toThrow(
      /WASSIST_TOOLSETS.* must list toolsets from agents, testing, whatsapp, conversations/,
    );
  });

  it('treats an empty read-only value as unset, as templated configs often send it', () => {
    expect(
      loadStdioConfig({ WASSIST_API_KEY: 'key-0123456789', WASSIST_READ_ONLY: '' }).tools.readOnly,
    ).toBe(false);
    expect(
      loadStdioConfig({ WASSIST_API_KEY: 'key-0123456789', WASSIST_READ_ONLY: 'true' }).tools
        .readOnly,
    ).toBe(true);
  });

  it('names the variable and never echoes its value', () => {
    expect(() => loadStdioConfig({})).toThrow(/WASSIST_API_KEY is not set/);
    expect(() => loadStdioConfig({ WASSIST_API_KEY: '' })).toThrow(/WASSIST_API_KEY is not set/);
    expect(() => loadStdioConfig({ WASSIST_API_KEY: 'has space' })).toThrow(ConfigError);
    expect(() => loadStdioConfig({ WASSIST_API_KEY: 'has space' })).not.toThrow(/has space/);
  });
});

describe('loadHttpConfig', () => {
  it('defaults to loopback with no OAuth', () => {
    const config = loadHttpConfig({});

    expect(config).toMatchObject({
      port: 8080,
      bindAddress: '127.0.0.1',
      allowedHosts: [],
      tools: { readOnly: false, toolsets: ['agents', 'testing', 'whatsapp', 'conversations'] },
    });
    expect(config.oauth).toBeUndefined();
  });

  it('turns OAuth on from PUBLIC_URL and allows its host', () => {
    const config = loadHttpConfig({
      PUBLIC_URL: 'https://Mcp.Example.com/',
      ALLOWED_HOSTS: 'other.example.com',
    });

    expect(config.oauth).toMatchObject({
      publicUrl: 'https://mcp.example.com',
      secretIsEphemeral: true,
    });
    expect(config.oauth?.secret.length).toBeGreaterThanOrEqual(32);
    expect(config.allowedHosts).toEqual(['other.example.com', 'mcp.example.com']);
  });

  it('uses the given secret and does not call it ephemeral', () => {
    const config = loadHttpConfig({ PUBLIC_URL: 'https://mcp.example.com', OAUTH_SECRET: SECRET });

    expect(config.oauth).toEqual({
      publicUrl: 'https://mcp.example.com',
      secret: SECRET,
      secretIsEphemeral: false,
      redirectHosts: [],
    });
  });

  it('accepts http only for localhost', () => {
    expect(loadHttpConfig({ PUBLIC_URL: 'http://localhost:8080' }).oauth?.publicUrl).toBe(
      'http://localhost:8080',
    );
    expect(() => loadHttpConfig({ PUBLIC_URL: 'http://mcp.example.com' })).toThrow(
      /PUBLIC_URL must be an https origin/,
    );
  });

  it.each([
    ['a path', 'https://mcp.example.com/mcp'],
    ['a query', 'https://mcp.example.com/?a=1'],
    ['credentials', 'https://user@mcp.example.com'],
    ['not a URL', 'mcp.example.com'],
  ])('rejects a PUBLIC_URL with %s', (_label, value) => {
    expect(() => loadHttpConfig({ PUBLIC_URL: value })).toThrow(/PUBLIC_URL/);
  });

  it('rejects a short secret and a secret without a public URL', () => {
    expect(() =>
      loadHttpConfig({ PUBLIC_URL: 'https://mcp.example.com', OAUTH_SECRET: 'short' }),
    ).toThrow(/at least 32/);
    expect(() => loadHttpConfig({ OAUTH_SECRET: SECRET })).toThrow(
      /OAUTH_SECRET requires PUBLIC_URL/,
    );
  });

  it('reads the redirect host allow-list', () => {
    const config = loadHttpConfig({
      PUBLIC_URL: 'https://mcp.example.com',
      OAUTH_REDIRECT_HOSTS: 'claude.ai, Claude.com',
    });

    expect(config.oauth?.redirectHosts).toEqual(['claude.ai', 'claude.com']);
    expect(loadHttpConfig({ PUBLIC_URL: 'https://mcp.example.com' }).oauth?.redirectHosts).toEqual(
      [],
    );
  });

  it('requires PUBLIC_URL for the allow-list and rejects hosts with a scheme', () => {
    expect(() => loadHttpConfig({ OAUTH_REDIRECT_HOSTS: 'claude.ai' })).toThrow(
      /OAUTH_REDIRECT_HOSTS requires PUBLIC_URL/,
    );
    expect(() =>
      loadHttpConfig({
        PUBLIC_URL: 'https://mcp.example.com',
        OAUTH_REDIRECT_HOSTS: 'https://claude.ai',
      }),
    ).toThrow(/OAUTH_REDIRECT_HOSTS/);
  });

  it('rejects an allowed host that is not a bare hostname', () => {
    expect(() => loadHttpConfig({ ALLOWED_HOSTS: 'https://mcp.example.com' })).toThrow(
      /ALLOWED_HOSTS/,
    );
  });
});
