# Contributing

Thanks for helping. Small fixes, new tools, client guides and bug reports are all welcome.

## Start with an issue

Every change starts as an issue, so we agree on the problem before anyone spends time on code. Pick the template that fits: a bug, a feature, or a docs problem. A couple of sentences is enough, even for a typo. For anything larger than a small fix, wait for a reply on the issue before you start.

Then open a pull request with `Closes #<number>` at the top, which the template already has a place for. That's the only rule a check enforces on you. The rest is ordinary CI, and when something like the generated tool docs is out of date, the failing test names the command that fixes it.

## Get set up

You need Node.js 22 or newer (`nvm use` reads `.nvmrc`) and git.

```bash
git clone https://github.com/1337Xcode/wassist-mcp-server.git
cd wassist-mcp-server
npm ci
npm run ci
```

`npm ci` also builds `dist`. `npm run ci` runs the linter, the type checker, a dead code check, a build and the full test suite. It needs no Wassist key and makes no network calls, so a fresh clone should pass. If it does not, that is a bug worth reporting.

## Find your way around

Each Wassist resource has one folder under `src/features`, such as `src/features/phone-numbers`. Its `api.ts` talks to Wassist and its `tools.ts` is what the AI client sees. Shared plumbing lives in `src/wassist`, the tool framework in `src/mcp`, and the two transports in `src/http` and `src/bin`. [docs/architecture.md](docs/architecture.md) explains how a request flows through them.

## Run it against your own account

Copy `.env.example` to `.env` and set `WASSIST_API_KEY`. Git ignores `.env`. Then run:

```bash
npm run test:live
```

That suite starts the server in read-only mode and only reads. It prints counts and never prints customer data. Do not add a test that writes to a real organization. Test writes against the fake in `tests/helpers/fake-wassist.ts`.

To try the server in a real client, `npm run inspect` opens the MCP Inspector on the stdio server, and `npm run start:http` starts the HTTP server. [docs/clients.md](docs/clients.md) shows how to connect each client.

## Adding a tool

1. Add the raw schema, output schema and operation to `api.ts` in the resource's folder under `src/features`. Check the path and body against the official OpenAPI file and the live API, and record any disagreement in `docs/wassist-api-notes.md`. A new resource gets a new folder with an `api.ts` and a `tools.ts`, and is listed in `src/api.ts` and in one toolset in `src/tools.ts`.
2. Define the tool in `tools.ts` in the same folder with `defineTool`. Pick the `effect` that matches what it does, use a strict input schema, and write a description that says when to use the tool, what it changes and what it returns.
3. Add tests that call the tool through the MCP client and assert the exact upstream request and the exact result. Cover a failure path.
4. Add the tool to the contract test list in `tests/contract/openapi.test.ts`. If the endpoint is new, run `npm run fixtures:openapi` first so the fixture knows it.
5. Run `npm run docs:tools` to regenerate `docs/tools.md`, and add the tool to its toolset table in the README, update the tool counts there, and add it to the skill in `plugins/wassist/skills`. Tests fail if the README or the skill misses a tool, or if any text the model reads names a tool that does not exist.
6. Run `npm run build:plugin`, which refreshes the server bundle that the plugin ships. A test fails when the bundle is stale.

A tool that returns data from Wassist must return only the fields the workflow needs. Never return credentials, tool schemas, webhook secrets or raw upstream bodies.

## Changing a manifest or the icon

The plugin, marketplace and extension manifests repeat some values. `npm run version:sync` copies the version from `package.json` and rebuilds the plugin bundle, and `tests/packaging` fails when the files disagree about names, repositories or configuration keys. After editing a manifest, run the Claude Code CLI check from the operations guide. If you replace `assets/icon.png`, copy it to `plugins/wassist/assets/icon.png` as well. The sign-in page carries its own copy of the logo in `src/oauth/logo.ts`, and a test fails if it drifts from `assets/logo-full-light.svg`.

## Code style

Biome formats and lints the project, so run `npm run format` before you commit. `npm run knip` finds unused files and exports, and CI fails on them.

Every top-level function, class, interface, constant and type in `src` has a comment above it, and a test fails when one does not. One line is enough for most: say what it is for, and add the reason when the code cannot show it, such as a Wassist quirk, a protocol rule or a security decision. Use a few lines when the behavior is subtle. A comment covers the one-line declarations that follow it directly, and a type that only restates a schema next to it needs none. Do not narrate the lines inside a function.

## Documentation

Write plain, specific sentences. Use sentence case for headings, avoid dashes as connectors, and keep formatting to what helps the reader find things.

## Pull requests

Keep each pull request to one change and one issue. The template lists the checks to run. Describe what changed and why, and update `CHANGELOG.md` for user-visible changes. Once CI passes, a maintainer reviews it and merges it.

Report security problems privately, as [SECURITY.md](SECURITY.md) describes.
