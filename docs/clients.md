# Connect your AI client

There are two ways to run the server.

- Local. Your client starts `wassist-mcp-server` as a process and passes your key in the `WASSIST_API_KEY` environment variable. Nothing is exposed to the network.
- Remote. You run the HTTP server behind HTTPS and the client connects to `https://your-host/mcp`. Web apps such as Claude.ai and ChatGPT need this, because their servers make the connection, so `localhost` does not work. Deploy it on a server you control, or use a tunnel such as Cloudflare Tunnel or ngrok to try it from your own machine.

Everything installs from this GitHub repository, and nothing comes from the npm registry. The plugins and the desktop extension carry their own copy of the server. For other clients, `npx -y github:1337Xcode/wassist-mcp-server` downloads the repository from GitHub and builds it on the first start, which takes about a minute and needs git. Later starts use a local cache. If your client gives up before the first start finishes, run the command once in a terminal. To skip the build entirely, clone the repository and use `node /absolute/path/to/wassist-mcp-server/plugins/wassist/server/index.mjs` as the command, which runs the ready-built server inside it.

## What has been tested

Verified means this project ran it. From the vendor's docs means the steps follow the vendor's current documentation and nobody has run them against the real app yet.

| Setup | Status |
| --- | --- |
| Server over stdio and HTTP with the MCP SDK client, both protocol revisions | Verified in the test suite |
| Sign-in flow with the MCP SDK's OAuth client, against the real Wassist API, through a public tunnel | Verified |
| Creating an agent and changing its prompt through that tunnel, then reverting both | Verified against a real account |
| Starting a test chat, sending a message and reading the answer | Verified against a real account, and the test chat was deleted afterwards |
| Agent tools, handoffs, test personas and test runs through the stdio server: add, keep a dashboard-only auth header across an edit, refuse duplicates, remove, run a two-turn test | Verified against a real account on 2026-09-30 with throwaway agents, all deleted afterwards |
| Attaching a connector | The write was checked with a direct API call. A connector added through the API reported no tool names, so the tool's name check was not exercised live |
| Sending messages, publishing templates, routing numbers and creating a WhatsApp link | Only run against the fake API, because they reach customers or Meta |
| Claude Code plugin: marketplace add, install, key prompt, bundled server connects | Verified in a sandboxed Claude Code config |
| `npx` from a git URL: clones, builds with `prepare`, and serves over stdio | Verified with a local git repository. The `github:` form itself needs the repository to be pushed. |
| Claude Desktop extension bundle: validates, starts, reads from Wassist | Verified with the MCPB CLI and an MCP client. The install dialog itself was not run. |
| Claude.ai, ChatGPT, Perplexity, Grok, Z.ai, Codex, Cursor, Windsurf, VS Code | From the vendor's docs |
| Gemini CLI extension | `gemini extensions validate` passes on Gemini CLI 0.42.0. The install itself was not run |
| Claude Code plugin and marketplace manifests | `claude plugin validate --strict` passes on Claude Code 2.1.224 |
| Sign-in page | Rendered in a browser in light and dark mode and at phone width, with the show-key button working under the page's content security policy |

## Claude Desktop

Extension. Download `wassist-mcp-server-<version>.mcpb` from the releases page, open it, and paste your API key. Claude Desktop keeps the key in the system keychain and asks whether to turn on read-only mode.

Config file. Add the standard block to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wassist": {
      "command": "npx",
      "args": ["-y", "github:1337Xcode/wassist-mcp-server"],
      "env": { "WASSIST_API_KEY": "your_key_here" }
    }
  }
}
```

## Claude Code

Plugin. It installs the server and a skill, and it asks for your key.

```bash
claude plugin marketplace add 1337Xcode/wassist-mcp-server
claude plugin install wassist@wassist-mcp-server
```

Run `/plugin configure wassist@wassist-mcp-server` inside Claude Code if you skipped the prompt. To install non-interactively, pass `--config api_key=your_key_here` to `install`.

Without the plugin:

```bash
claude mcp add wassist -e WASSIST_API_KEY=your_key_here -- npx -y github:1337Xcode/wassist-mcp-server
```

Remote, with a header or with the sign-in page:

```bash
claude mcp add --transport http wassist https://your-host/mcp --header "X-API-Key: your_key_here"
claude mcp add --transport http wassist https://your-host/mcp
```

The second command has no key. Run `/mcp` in Claude Code to sign in.

## Claude.ai on the web and mobile

Set `PUBLIC_URL` on the server first, as the README describes. Then open Customize, Connectors, Add custom connector, and enter `https://your-host/mcp`.

Claude checks the address and pre-fills the authentication it detects. This server offers a sign-in, so Claude picks Sign in now. Keep that, click Connect, and paste your Wassist key on the page that opens. You do this once.

To skip the page, you can send the key as a header instead. Claude is rolling Request headers out gradually, so you may not see the option yet. Where you do, change the authentication to No sign-in, add a request header named `x-api-key` with your key as the value, and save. Claude then connects straight away. Leaving the authentication on Sign in now and adding a header as well still opens the page, because Claude finishes its sign-in before it sends anything.

Once connected, Claude lists the tools in two groups, read-only and write, based on each tool's annotations. You can set each group or each tool to Always allow, Needs approval or Blocked.

Status: from the vendor's docs. The sign-in flow follows the MCP authorization spec, and the MCP SDK's own client completes it.

## ChatGPT and Codex

ChatGPT connects to a remote server, and it expects OAuth for anything that needs a login. Turn on Developer mode under Settings, Security and login, then add `https://your-host/mcp` as a plugin or app and choose OAuth. OpenAI's docs describe full MCP support as a beta for Business, Enterprise and Edu workspaces, so check what your plan offers.

The repository is also a plugin marketplace for the ChatGPT desktop app and Codex:

```bash
codex plugin marketplace add 1337Xcode/wassist-mcp-server
```

Then install Wassist from the plugin directory. The plugin starts its bundled copy of the server with `node`, and the plugin format has no place for secrets, so export `WASSIST_API_KEY` in the environment that launches the app.

Codex on its own:

```bash
codex mcp add wassist --env WASSIST_API_KEY=your_key_here -- npx -y github:1337Xcode/wassist-mcp-server
codex mcp add wassist --url https://your-host/mcp --bearer-token-env-var WASSIST_API_KEY
```

The second command reads your Wassist key from that environment variable and sends it as a bearer token.

Status: the `codex` commands were checked against Codex CLI 0.130.0. The plugin marketplace was accepted by that CLI. Nothing was run against ChatGPT itself.

## Perplexity

Open Account settings, Connectors, Custom connector, Remote. Enter `https://your-host/mcp` (HTTPS is required), pick Streamable HTTP, and choose OAuth as the authentication. The sign-in page then asks for your Wassist key.

Perplexity also offers an API Key option. It may work if Perplexity sends the key as a bearer token, and that has not been tested.

## Grok and xAI

xAI's Responses API calls remote MCP servers for you, so the server must be reachable from the internet. Restrict the tools to reads while you test:

```bash
curl https://api.x.ai/v1/responses \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-4.6",
    "input": "List my Wassist agents and the numbers they answer.",
    "tools": [{
      "type": "mcp",
      "server_url": "https://your-host/mcp",
      "server_label": "wassist",
      "headers": { "X-API-Key": "'"$WASSIST_API_KEY"'" },
      "allowed_tools": ["wassist_list_agents", "wassist_get_agent", "wassist_list_phone_numbers"]
    }]
  }'
```

Replace the model name with the Grok model you use. The Grok CLI takes a header too:

```bash
grok mcp add --transport http wassist https://your-host/mcp --header "X-API-Key: ${WASSIST_API_KEY}"
```

Status: from the vendor's docs.

## Z.ai

ZCode supports stdio and HTTP servers. Under Settings, MCP Servers, add a server. For stdio, use the command `npx`, the arguments `-y github:1337Xcode/wassist-mcp-server` and the environment variable `WASSIST_API_KEY`. For HTTP, enter `https://your-host/mcp` and add an `X-API-Key` header. The Z.ai API can also call a remote server with a URL and headers, as its MCP calling guide describes. Claude Code with Z.ai models uses the Claude Code steps above.

Status: from the vendor's docs.

## Gemini CLI

```bash
gemini extensions install https://github.com/1337Xcode/wassist-mcp-server
```

Gemini asks for your Wassist API key while it installs and keeps it in your system keychain. The extension runs the same bundled server as the Claude plugin, so it needs Node.js and nothing else. Change the key later with `gemini extensions config wassist`.

Status: the manifest passes `gemini extensions validate` on Gemini CLI 0.42.0. The install itself was not run.

## Cursor, Windsurf and VS Code

Cursor reads `~/.cursor/mcp.json`. Windsurf reads `~/.codeium/windsurf/mcp_config.json`. Both accept the standard block from the Claude Desktop section. For a remote server, Cursor takes a URL and headers:

```json
{
  "mcpServers": {
    "wassist": {
      "url": "https://your-host/mcp",
      "headers": { "X-API-Key": "your_key_here" }
    }
  }
}
```

VS Code reads `.vscode/mcp.json`, and its `inputs` block asks for the key with a masked prompt instead of storing it in a file you might commit:

```json
{
  "inputs": [
    { "type": "promptString", "id": "wassist-api-key", "description": "Wassist API key", "password": true }
  ],
  "servers": {
    "wassist": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:1337Xcode/wassist-mcp-server"],
      "env": { "WASSIST_API_KEY": "${input:wassist-api-key}" }
    }
  }
}
```

## Running a remote server safely

The server treats every request as a separate caller and keeps no organization key of its own, but a public URL still deserves care.

- Serve it over HTTPS only. The server does not terminate TLS, so use a proxy or tunnel.
- Run it for yourself or your team. Anyone who can reach the URL can open the sign-in page, and only a valid Wassist key gets past it.
- Set `OAUTH_SECRET` to a fixed random value so sign-ins survive a restart, and change it to sign everyone out.
- Set `OAUTH_REDIRECT_HOSTS` to the hosts of the apps you use, such as `claude.ai,claude.com`, so a stranger cannot register an app with their own callback and send you a sign-in link.
- Use `WASSIST_READ_ONLY=true` for a deployment that should never change anything.

[docs/security.md](security.md) explains what the sign-in page stores and what it does not.
