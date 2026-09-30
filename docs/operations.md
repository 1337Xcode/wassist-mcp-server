# Operations

## Running over stdio

The MCP client starts the process and owns its lifetime. Nothing needs to be deployed. Give the client the command `npx -y github:1337Xcode/wassist-mcp-server`, or `node dist/bin/stdio.js` from a checkout, and the `WASSIST_API_KEY` environment variable. Diagnostics go to stderr, and stdout carries only protocol messages.

Check a setup with the MCP Inspector:

```bash
npm run build
WASSIST_API_KEY=your_key_here npm run inspect
```

## Running over HTTP

```bash
npm run build
npm run start:http
```

The server listens on `127.0.0.1:8080` and serves MCP at `/mcp`. `GET /healthz` answers `200` with the version and needs no credentials, so it suits a load balancer probe.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `8080` | |
| `BIND_ADDRESS` | `127.0.0.1` | Use `0.0.0.0` only behind a TLS proxy. The server logs a warning when you do. |
| `ALLOWED_HOSTS` | none | Comma-separated bare hostnames, for example `mcp.example.com`. |
| `PUBLIC_URL` | none | The address clients use, such as `https://mcp.example.com`, with no path. Turns on the sign-in page and allows its host. |
| `OAUTH_REDIRECT_HOSTS` | any | Comma-separated hostnames that may receive sign-in codes over https, such as `claude.ai,claude.com`. Localhost callbacks are always allowed. Requires `PUBLIC_URL`. |
| `OAUTH_SECRET` | random | 32 or more characters. Without it, sign-ins end when the process restarts. Requires `PUBLIC_URL`. |
| `WASSIST_READ_ONLY` | `false` | Applies to every caller of this deployment. |
| `WASSIST_TOOLSETS` | all | Loads only these groups of tools for every caller, such as `agents,testing`. |

`WASSIST_API_KEY` is ignored in HTTP mode. Callers supply their own keys, or sign in.

Make a secret with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Changing it signs everyone out.

### Trying it from your own machine

Web apps connect from their own servers, so they need a public HTTPS address even when you are only testing. A tunnel gives your machine one for as long as it runs. Any tunnel works. These two need the least setup:

```bash
cloudflared tunnel --url http://localhost:8080   # Cloudflare, no account needed
ngrok http 8080                                   # ngrok, free account
```

Then start the server with the address the tunnel printed. `npm run serve -- https://your-tunnel-address` does this and prints the connector link, or set `PUBLIC_URL` and `OAUTH_SECRET` and run `npm run start:http`. The tunnel's host is allowed automatically. Add `https://your-tunnel-address/mcp` as a custom connector and sign in with your Wassist API key.

A quick tunnel gets a new address each time it starts. Start the server again with the new address and add the connector again, because each address is a different server to the app. For regular use, run the server on a host with a fixed address, as described below.

Clients that can send a header can skip the sign-in and send `X-API-Key`. In that case `PUBLIC_URL` is optional, and `ALLOWED_HOSTS` must name the tunnel domain.

### Behind a reverse proxy

The proxy terminates TLS and forwards to the server. It must pass the original `Host` header, or the proxy's own hostname must be in `ALLOWED_HOSTS`. Set `PUBLIC_URL` to the address clients use, not the address behind the proxy. The proxy should also cap request size and rate, since the server's own limiter is per process.

MCP responses can be streamed as server-sent events, so turn off response buffering on the proxy for `/mcp`.

## Logs

Each line is a JSON object with `time`, `level` and `message`. The messages worth alerting on:

| Message | Meaning |
| --- | --- |
| `tool failed` | A tool returned an error. The fields `tool`, `code`, `status` and `requestId` say which. |
| `mcp request failed` | The MCP layer rejected a request, for example a malformed one. |
| `http request failed` | An unexpected failure in the HTTP server, answered with `500`. |

Tool failures with code `unauthorized` mean a caller's key is wrong or revoked. Codes `rate_limited` and `upstream_error` point at Wassist. The `requestId` is the Wassist `X-Request-Id`, which Wassist support can use.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| The process exits with `WASSIST_API_KEY is not set` | The client did not pass the environment variable. Set it in the client's `env` block. |
| The process exits with a message about `PUBLIC_URL` | It must be an https origin with no path. Plain http is only accepted for `localhost`. |
| Every tool returns `unauthorized` | The key is wrong or was revoked. Create a new one under Settings, Developers, API keys. |
| `403` from the HTTP server | The Host or Origin header is not allowed. Add the hostname to `ALLOWED_HOSTS`, or set `PUBLIC_URL` to it. |
| `401` from the HTTP server | The request has no usable credential. Send `X-API-Key`, or sign in through the app. |
| Claude.ai shows "not connected" although a request header is set | Claude marks a connector connected only after the OAuth sign-in completes once. Click Connect and paste the key on the page; the header is optional. |
| The app cannot register, with a message about an allowed host | The app's callback host is not in `OAUTH_REDIRECT_HOSTS`. Add it and restart. |
| The app says the sign-in failed or loops | `PUBLIC_URL` does not match the address the app uses, or the server restarted without `OAUTH_SECRET`. Fix the address and connect again. |
| The sign-in page says Wassist did not accept the key | The key is wrong or revoked. Create a new one under Settings, Developers, API keys. |
| `429` from the HTTP server | One key sent more than 120 requests in a minute. Wait for `Retry-After`. |
| A tool returns `rate_limited` | Wassist allows 100 requests per minute per key. Wait and retry. |
| `wassist_connect_agent_to_number` fails on the sandbox number | API keys cannot change sandbox routing, and Wassist answers `400`. Open the agent's `connectUrl` in WhatsApp on the phone you signed in with, or set routing in the dashboard under Numbers, Sandbox numbers. |
| A stdio client reports invalid JSON from the server | Something wrote to stdout. `npx` can print install notices, so use `npx -yq` or run `node` directly. The first `npx github:` start also prints build output to stderr, which is harmless. |

## Upgrading

Update the checkout, run `npm ci` and `npm run build`, and restart. Stdio clients pick the new version up the next time they launch the process. Tools are listed in a fixed order, so clients can cache the list between versions.

## Releasing

Everything below runs from a clean checkout of the branch you are releasing. Nothing goes to npm.

1. Update `CHANGELOG.md`, then set the new version with `npm version <version> --no-git-tag-version` and run `npm run version:sync`. That copies the number into the plugin and marketplace manifests and rebuilds the plugin's server bundle. A test fails if any file disagrees.
2. Run `npm run ci` and `npm run test:live` with a real key.
3. Merge to the default branch. Claude Code and Codex users get the plugin from whatever is on that branch, so merge only when the version is ready.
4. Tag the merge commit and push the tag: `git tag v<version>` and `git push origin v<version>`. The release workflow checks that the tag matches `package.json`, runs the full check, builds the `.mcpb` file and creates the GitHub release with it attached. The Claude Desktop instructions point at that release.

Run `claude plugin validate plugins/wassist --strict` and `claude plugin validate .claude-plugin/marketplace.json --strict` when you change a manifest. The tests check that the manifests agree with each other, and the Claude Code CLI is the authority on whether it accepts them.
