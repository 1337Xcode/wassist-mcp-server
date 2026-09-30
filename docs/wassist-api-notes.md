# Wassist API notes

What the server relies on, where each fact came from, and where the sources disagree. Checked on 2026-09-29, and again on 2026-09-30 for agent tools, connectors and test runs. On 2026-09-30 the published OpenAPI file still had the SHA-256 recorded below, and `@wassist/sdk` 0.3.0 was still the latest release.

## Sources

| Source | Used for |
| --- | --- |
| [docs.wassist.app](https://docs.wassist.app) API reference and guides | Endpoint behavior, authentication, rate limits, routing rules |
| `https://docs.wassist.app/api-reference/openapi.json` | Paths, methods and request fields. The operations and their body fields are kept in `tests/fixtures/wassist-openapi.json`, and `npm run fixtures:openapi` refreshes it. The file had SHA-256 `defcd105...` on 2026-09-29. |
| `@wassist/sdk` 0.3.0 source and types, read but not installed | Request bodies the OpenAPI file gets wrong, and field names |
| Read-only calls to the production API | The real response shapes |

## Confirmed facts

- The production base URL is `https://backend.wassist.app/api/v1/`. An unauthenticated request answers `401`. The OpenAPI file lists a development tunnel as its server, and this project never uses it.
- Authentication is the `X-API-Key` header. Keys are organization credentials and the reference documents no scopes.
- The documented rate limit is 100 requests per minute per key, and a `429` body carries `retry_after`.
- Paths in the OpenAPI file all end in a slash, and the client always sends them that way. The API does not redirect these requests.
- API keys cannot change routing on the shared sandbox number. The routing guide says such calls return `400`, and a live call confirmed it. Every agent carries a `connectUrl` of the form `https://wa.me/<sandbox number>?text=/connect:<agent id>`, observed on the live API on 2026-09-29. The docs do not describe it beyond calling the field read-only, so the tools offer it as the way to try an agent from a phone, with the dashboard as the documented fallback.
- Webhooks cannot be created through the API. The routing guide says they are created in the dashboard.
- An agent's `tools`, `websiteTools`, `handoffTools` and `mcpConfigs` are written with `PATCH /agents/{id}/`. Each list sent replaces the stored one: entries with an `id` are updated, entries without one are created, and existing entries left out are deleted. The configure-tools guide says this and shows the read, append and write pattern, and the SDK's `UpdateAgentInput` says Wassist "diffs them server-side by `id`".
- An API tool's `apiSchema` has `url`, `method`, `path_params`, `query_params`, `request_body` and `request_headers`, as the configure-tools guide documents and a live read of an agent's tool showed on 2026-09-30. Each parameter has an `input` that is either `{ type: "description" }`, filled in by the model, or `{ type: "value" }`, fixed.
- `GET /integrations/connectors/`, `GET /integrations/connectors/public/`, `GET /test-personas/` and `GET /test-runs/` answer `200` with a bare array, observed on 2026-09-30 with read-only calls that recorded only field names and types. The public catalog held 42 connectors, each with `knownTools` of `id`, `name`, `description` and `inputSchema`.
- Connectors are MCP servers reached over Streamable HTTP, with no auth or with OAuth. The guide connects one in the dashboard under Integrations, Connectors, where the OAuth sign-in happens, and then attaches it to an agent with a list of allowed tools.

## Where the sources disagree

| Topic | OpenAPI file | Live API | Official SDK | What this server does |
| --- | --- | --- | --- | --- |
| `GET /phone-numbers/` | bare array | bare array | paginated envelope | accepts both shapes |
| `GET /whatsapp-templates/` | bare array | bare array | paginated envelope | accepts both shapes |
| `GET /whatsapp-accounts/` | bare array | bare array | paginated envelope | accepts both shapes |
| `GET /conversations/{id}/messages/` | paginated envelope | bare array | handles both in 0.3.0 | accepts both shapes |
| `GET /agents/`, `GET /conversations/` | paginated envelope | paginated envelope | paginated envelope | accepts both shapes |
| Agent `reasoningEffort` | absent from `PatchedAgent` | returned by `GET` | in the guides | sends it, and the contract test lists it as a known gap |
| `connect-agent` and `unsubscribe` request bodies | described as a phone number | not called during verification | `agentId` and `applyToExisting` | follows the SDK and the guides |
| Response fields such as `Conversation.lastMessage` | typed as strings | objects | objects | follows the live shape |
| `GET /simulations/{id}/messages/` | the whole chat object | bare array of messages | reads the messages | accepts the array and the chat object |
| `GET /simulations/{id}/` | the whole chat object | `404` for every chat that was listed, on 2026-09-29 | reads the chat | not called |
| `POST /simulations/{id}/messages/` | body is `content` as a string, returns the chat | needs `content` as an object with `body`, and `messageType`. Returns the chat with only the sent message and `isProcessing: true` | create and send are not in the SDK | sends the live body, then reads the messages until the answer stops growing |
| Sending free-form text | `text` type exists | not called | `text` is deprecated in the docs | sends a `unified` message with `text` |
| Agent tool lists on `PATCH /agents/{id}/` | read-only on `PatchedAgent`, though `UpdateAgentInput` lists them | not written during verification | writable, replaced as a whole | follows the guide and the SDK, and writes one list at a time |
| `GET /integrations/connectors/public/` | one `Connector` object | a list of connectors | not in the SDK | accepts a list or an envelope |
| Test run `messages` | typed as a string | not observed, because no run existed | not in the SDK | accepts a list of messages or a JSON string of one, and reports `transcriptReadable: false` for anything else |
| `unified` message field for the body | `text` | not called | `text` on send, `body` on read | uses `text` to send, and `body` to read |

One design blueprint that came with the Wassist reference material uses `unified.body` for sending, a `takeover` endpoint set, a webhooks endpoint set and simulations. The OpenAPI file declares the last three, but the reference pages do not document them and the routing guide contradicts the webhook one. They are out of scope here.

## Test chats

The API calls them simulations and the dashboard calls them test chats. Creating one with an API key, sending a message, and reading the agent's answer was run against the live API on 2026-09-29 on an agent made for the purpose, and the test chat was deleted afterwards. The answer arrived about two seconds after the send. Wassist runs the agent as it would for a customer, so its tools run for real.

## Unverified

Nothing in the server depends on these, and each one is why a choice was made:

- The `Idempotency-Key` header. It appears only in the SDK README, not in the API reference, so writes are never retried.
- The default for `applyToExisting` on routing calls. The tools make the caller choose.
- The exact text of the error Wassist returns when the 24-hour window is closed. The send tool attaches its hint to any rejected request instead of matching text.
- Whether an empty `toolWhitelist` means every tool or none. The connector tool requires at least one tool name, so the question never comes up.
- Whether `mcpConfigs` accepts the id of a catalog connector the organization has not connected. The tool only attaches the organization's own connectors.
- The parameter `type` values an API tool accepts beyond `string`, which is the only one the guide shows. The tool also offers `number`, `integer` and `boolean`, as in JSON Schema.
- The default and the maximum for a test run's `maxTurns`. The tool leaves it out unless the caller sets it, and caps it at 20.
- Response shapes for most write endpoints. Creating and updating an agent and the test chat calls were run against the real API on 2026-09-29. The rest, including creating a WhatsApp link, follow the OpenAPI file and the SDK types, and the parsers tolerate missing and null fields.

## Intentionally not exposed

| Area | Reason |
| --- | --- |
| Deleting agents, templates and conversations | Irreversible, and the first release does not need them |
| Starting a conversation | Can message any phone number, and Meta bills template sends |
| Prompting an agent inside a conversation | The agent decides what to say, so the effect on the customer is open ended |
| Routing to webhooks | Webhooks cannot be created through the API |
| Paywalls, credits, memory keys, wake-ups and outbound triggers | Outside the build workflows so far. The capability tools show how to add a list safely if they are needed |
| Uploading or removing knowledge documents | The upload flow for `documents` is not documented |
| Creating connectors | Most need an OAuth sign-in with the other service, which a person has to do in a browser |
| Updating an API tool, web page or handoff in place | Remove and add gives the same result with less to get wrong. Connectors can be updated, because their tool list is the thing people change |
| The Meta Graph proxy | A generic proxy would be an arbitrary API caller |
| Account link sessions, business profile, blacklists | Outside the first workflows |
