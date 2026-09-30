import { createHash } from 'node:crypto';
import { LOGO_SVG } from './logo.js';

/** The characters that must not appear raw in HTML text or attributes. */
const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes a value for use in HTML text or a quoted attribute. */
const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);

/** Where the sign-in server serves Geist from, so the page makes no request to another host. */
export const FONT_PATH = '/oauth/geist.woff2';

/** Inline styles. They follow the reader's light or dark setting. */
const STYLE = `
@font-face { font-family: 'Geist'; src: url('${FONT_PATH}') format('woff2'); font-weight: 100 900; font-display: swap; }
:root { color-scheme: light dark; --bg: #fafafa; --card: #ffffff; --fg: #0a0a0a; --muted: #6b6b6b; --line: #e5e5e5; --button: #171717; --button-fg: #ffffff; --button-hover: #2b2b2b; --error: #c62828; }
@media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --card: #111111; --fg: #ededed; --muted: #a1a1a1; --line: #262626; --button: #ededed; --button-fg: #0a0a0a; --button-hover: #ffffff; --error: #ff8a80; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: 1.25rem; background: var(--bg); color: var(--fg); font: 15px/1.5 'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
main { width: 100%; max-width: 23rem; padding: 2rem; background: var(--card); border: 1px solid var(--line); border-radius: 6px; }
.logo { display: block; width: 6.5rem; height: auto; margin-bottom: 1.75rem; }
h1 { margin: 0 0 0.35rem; font-size: 1.25rem; font-weight: 600; letter-spacing: -0.02em; line-height: 1.3; overflow-wrap: anywhere; }
p { margin: 0; }
.lead { margin-bottom: 1.5rem; color: var(--muted); font-size: 0.9rem; }
.field { position: relative; }
input { width: 100%; padding: 0.7rem 2.75rem 0.7rem 0.8rem; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: inherit; font: inherit; font-size: 0.9rem; }
input::placeholder { color: var(--muted); }
input[aria-invalid='true'] { border-color: var(--error); }
input:focus-visible, button:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
.reveal { position: absolute; top: 50%; right: 0.4rem; display: grid; place-items: center; width: 2rem; height: 2rem; padding: 0; transform: translateY(-50%); border: 0; border-radius: 4px; background: none; color: var(--muted); cursor: pointer; }
.reveal[hidden] { display: none; }
.reveal:hover { color: var(--fg); }
.reveal svg { width: 1.1rem; height: 1.1rem; }
.reveal[aria-pressed='true'] .eye, .reveal[aria-pressed='false'] .eye-off { display: none; }
.status { min-height: 1.35rem; margin: 0.3rem 0 0.5rem; color: var(--error); font-size: 0.85rem; }
.submit { width: 100%; padding: 0.7rem; border: 1px solid var(--button); border-radius: 6px; background: var(--button); color: var(--button-fg); font: inherit; font-weight: 500; cursor: pointer; box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.12); }
.submit:hover { background: var(--button-hover); }
.note { margin-top: 1.25rem; color: var(--muted); font-size: 0.85rem; text-align: center; }
a { color: var(--fg); text-underline-offset: 0.2em; }
@media (max-width: 30rem) { body { padding: 0; } main { max-width: none; min-height: 100dvh; padding: 2rem 1.5rem; border: 0; border-radius: 0; } }
`;

/** An open eye and a crossed-out eye for the show-key button. Inline, so they need no request. */
const EYE_ICONS =
  '<svg class="eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>' +
  '<svg class="eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

/**
 * The page's only script: it shows the show-key button and switches the field between hidden and
 * plain text. It is a constant, and the content security policy allows it by hash and nothing
 * else, so no value from a request can ever run. Without it the field still works, masked.
 */
const REVEAL_SCRIPT = `const input = document.getElementById('api_key');
const toggle = document.getElementById('reveal');
toggle.hidden = false;
toggle.addEventListener('click', () => {
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  toggle.setAttribute('aria-pressed', String(show));
  toggle.setAttribute('aria-label', show ? 'Hide key' : 'Show key');
  input.focus();
});`;

/** The CSP source that allows `REVEAL_SCRIPT` and no other script. */
export const SCRIPT_SOURCE = `'sha256-${createHash('sha256').update(REVEAL_SCRIPT).digest('base64')}'`;

/** Wraps content in the shared page shell. */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${LOGO_SVG}
${body}
</main>
</body>
</html>
`;
}

/**
 * The Wassist dashboard page where API keys are created. A constant, so nothing a request sends
 * can change where the link goes.
 */
const API_KEYS_URL = 'https://wassist.app/settings/developers/api-keys/';

/** What the sign-in page shows and posts back. */
interface ConsentDetails {
  clientName: string;
  /** The sealed authorization request, posted back untouched. */
  authorization: string;
  /** A short reason the last attempt failed. The line is always there, so the card never jumps. */
  error?: string;
}

/**
 * The page where the user pastes a Wassist API key to connect an assistant. Wassist has no OAuth
 * of its own, so this page is where the key is handed over. It is kept short on purpose: the app
 * asking, the key field, and a link to create a key. The app name is the only value that comes
 * from the request, and it is escaped.
 */
export function consentPage({ clientName, authorization, error }: ConsentDetails): string {
  const title = `Connect ${clientName} to Wassist`;
  return page(
    title,
    `<h1>${escapeHtml(title)}</h1>
<p class="lead">Your key is checked with Wassist and is not stored on this server.</p>
<form method="post" action="/oauth/authorize">
<input type="hidden" name="authorization" value="${escapeHtml(authorization)}">
<div class="field">
<input id="api_key" name="api_key" type="password" required maxlength="512" autocomplete="off" spellcheck="false" autofocus placeholder="Wassist API key" aria-label="Wassist API key"${error ? ' aria-invalid="true" aria-describedby="status"' : ''}>
<button type="button" id="reveal" class="reveal" aria-label="Show key" aria-pressed="false" hidden>${EYE_ICONS}</button>
</div>
<p class="status" id="status" role="alert">${escapeHtml(error ?? '')}</p>
<button type="submit" class="submit">Connect</button>
</form>
<p class="note">Don't have a key? <a href="${API_KEYS_URL}" target="_blank" rel="noopener noreferrer">Create one in Wassist</a></p>
<script>${REVEAL_SCRIPT}</script>`,
  );
}

/** A plain page for a request that cannot continue, such as an unknown client or an expired link. */
export function messagePage(title: string, message: string): string {
  return page(title, `<h1>${escapeHtml(title)}</h1>\n<p class="lead">${escapeHtml(message)}</p>`);
}
