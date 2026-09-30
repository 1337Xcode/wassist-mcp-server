import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { GUIDE_INDEX, GUIDE_TOPICS, GUIDES } from '../../src/features/guides/content.js';
import { FakeWassist } from '../helpers/fake-wassist.js';
import { connectTools, type Session } from '../helpers/mcp.js';

// Guides are local content, so a fake that records any call is all they need.
let session: Session | undefined;
afterEach(() => session?.close());

async function call(args?: { topic?: string }) {
  const fake = new FakeWassist();
  session = await connectTools(fake);
  const result = await session.call('wassist_guide', args ?? {});
  return { fake, ...result };
}

describe('wassist_guide', () => {
  it('lists the topics when called without one', async () => {
    const { isError, data, fake } = await call();

    expect(isError).not.toBe(true);
    expect(data.topics).toEqual([...GUIDE_TOPICS]);
    for (const topic of GUIDE_TOPICS) expect(data.guide).toContain(topic);
    expect(fake.requests).toHaveLength(0);
  });

  it('returns the guide for a topic', async () => {
    const { data } = await call({ topic: 'sandbox' });

    expect(data.guide).toContain('connectUrl');
  });

  it('rejects a topic that does not exist', async () => {
    const { isError } = await call({ topic: 'billing' });

    expect(isError).toBe(true);
  });
});

describe('text the model reads', () => {
  // A guide once sent the model to a tool that did not exist, so every name mentioned anywhere
  // the model or a skill reads has to be a real tool.
  it('names only tools that exist', async () => {
    const fake = new FakeWassist();
    session = await connectTools(fake);
    const { tools } = await session.client.listTools();
    const known = new Set(tools.map((tool) => tool.name));
    const skill = readFileSync(
      fileURLToPath(
        new URL('../../plugins/wassist/skills/wassist-agent-builder/SKILL.md', import.meta.url),
      ),
      'utf8',
    );
    const texts = [
      ...Object.values(GUIDES),
      GUIDE_INDEX,
      session.client.getInstructions() ?? '',
      skill,
      ...tools.map((tool) => tool.description ?? ''),
    ];
    const mentioned = new Set(texts.flatMap((text) => text.match(/\bwassist_[a-z_]+/g) ?? []));

    expect([...mentioned].filter((name) => !known.has(name))).toEqual([]);
  });
});
