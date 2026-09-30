Closes #<!-- issue number. Every pull request starts from an issue, and a check fails without one. -->

## What changed and why

<!-- One or two sentences. -->

## How it was tested

<!-- The tests you added or ran, and anything you checked by hand. -->

## Checks

- [ ] `npm run ci` passes
- [ ] New or changed tools have tests that call them through the MCP client
- [ ] `npm run docs:tools` was run if a tool changed
- [ ] `npm run build:plugin` was run if anything in `src` changed
- [ ] Every new top-level declaration in `src` has a comment
- [ ] `CHANGELOG.md` is updated for user-visible changes
- [ ] No real API key, phone number or customer text is in the diff
