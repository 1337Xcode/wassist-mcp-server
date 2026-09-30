import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOGO_SVG } from '../../src/oauth/logo.js';
import { consentPage, SCRIPT_SOURCE } from '../../src/oauth/pages.js';

// The details every sign-in page needs.
const details = { clientName: 'Claude', authorization: 'wsm1.a.b.c' };

describe('the sign-in page', () => {
  it('keeps the same layout when an attempt fails, so the card never jumps', () => {
    const calm = consentPage(details);
    const failed = consentPage({ ...details, error: 'Wassist did not accept that key.' });
    const withoutMessage = failed
      .replace('Wassist did not accept that key.', '')
      .replace(' aria-invalid="true" aria-describedby="status"', '');

    expect(calm).toContain('<p class="status" id="status" role="alert"></p>');
    expect(withoutMessage).toBe(calm);
  });

  it('links to the fixed page where a key is created, in a new tab', () => {
    const html = consentPage(details);

    expect(html).toContain(
      '<a href="https://wassist.app/settings/developers/api-keys/" target="_blank" rel="noopener noreferrer">',
    );
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it('names the app in the title and escapes whatever it calls itself', () => {
    const html = consentPage({ ...details, clientName: '"><img src=x onerror=alert(1)>' });

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('has one key field, one submit button and a show-key toggle that cannot submit', () => {
    const html = consentPage(details);

    expect(html.match(/name="api_key"/g)).toHaveLength(1);
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toContain('<button type="button" id="reveal"');
    expect(html.match(/<form /g)).toHaveLength(1);
  });

  it('runs only the script the content security policy allows by hash', () => {
    const html = consentPage(details);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
      (match) => match[1] ?? '',
    );
    const hash = createHash('sha256')
      .update(scripts[0] ?? '')
      .digest('base64');

    expect(scripts).toHaveLength(1);
    expect(SCRIPT_SOURCE).toBe(`'sha256-${hash}'`);
    expect(consentPage({ ...details, clientName: 'Other app' })).toContain(scripts[0]);
  });

  it('loads nothing from another host', () => {
    const html = consentPage(details);

    expect(html).not.toMatch(/<(img|link)[\s>]|<script src/);
    expect([...html.matchAll(/url\('([^']+)'\)/g)].map((match) => match[1])).toEqual([
      '/oauth/geist.woff2',
    ]);
  });
});

describe('the inline logo', () => {
  it('is the brand logo, with lettering that follows the text color', () => {
    const asset = readFileSync(
      fileURLToPath(new URL('../../assets/logo-full-light.svg', import.meta.url)),
      'utf8',
    );
    const paths = (svg: string) => [...svg.matchAll(/ d="([^"]+)"/g)].map((match) => match[1]);

    expect(LOGO_SVG).toContain('aria-label="Wassist"');
    expect(LOGO_SVG).toContain('fill="currentColor"');
    expect(paths(LOGO_SVG)).toEqual(paths(asset));
  });
});
