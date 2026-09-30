# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through the repository's private vulnerability reporting (the Security tab, then Report a vulnerability). Please do not open a public issue, draft pull request or discussion for a security report.

Include the version, how you run the server (stdio or HTTP, with or without the sign-in page), and steps to reproduce. Never include a real Wassist API key or customer data. If a key was exposed while you were testing, revoke it under Settings, Developers, API keys in the Wassist dashboard.

## Supported versions

Only the latest minor release receives security fixes. Pin to the latest patch of that minor.

## Security model

The server acts with a Wassist API key that can control a whole organization. [docs/security.md](docs/security.md) describes how the key is handled, what data reaches the model, the HTTP transport's guards, the sign-in page and the known limits.

In short:

- On stdio the key comes from the environment. On HTTP each request supplies its own key or a token from the sign-in page, and the server stores no key.
- The server only contacts `backend.wassist.app`, never follows redirects and never retries a write.
- Results leave out agent tool credentials, webhook secrets and tool arguments, and logs never contain message text, keys or tokens.
- `WASSIST_READ_ONLY=true` removes every write tool.
- Run a remote server for yourself or your team. Do not offer an open instance to the public.
