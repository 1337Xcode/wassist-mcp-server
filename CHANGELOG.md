# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-09-30

First release.

### Added

- 32 tools for building and running WhatsApp agents on Wassist: agents, API tools, web pages, MCP connectors, handoffs between agents, test chats, automated test runs with simulated customers, phone numbers, conversations, messages, message templates and WhatsApp Business Accounts, plus an in-chat guide.
- Safe edits to an agent's tool lists. Each change keeps every existing entry, including settings added in the dashboard, and checks the result afterwards.
- A stdio transport that reads `WASSIST_API_KEY`, and a Streamable HTTP transport that takes the key from each request.
- A sign-in page for web apps such as Claude.ai and ChatGPT, switched on by `PUBLIC_URL`. It follows the MCP authorization spec, stores no sessions and rotates refresh tokens.
- `WASSIST_READ_ONLY` to hide every tool that changes anything, and `WASSIST_TOOLSETS` to load only some groups of tools.
- A Wassist API client that pins the API host, never follows redirects, retries only reads and validates every response.
- Installs for Claude Code, ChatGPT and Codex (plugin), Claude Desktop (extension), Gemini CLI (extension), and any other MCP client, all from GitHub.
- A SHA-256 checksum for each release download, and signed build provenance for the desktop extension and the plugin bundle.
- Tests through a real MCP client over stdio and HTTP, a full OAuth sign-in, a contract check against the official Wassist OpenAPI file, and an opt-in read-only check against the live API.

[Unreleased]: https://github.com/1337Xcode/wassist-mcp-server/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/1337Xcode/wassist-mcp-server/releases/tag/v0.1.0
