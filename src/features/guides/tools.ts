import { z } from 'zod';
import { defineTool } from '../../mcp/tool.js';
import { GUIDE_INDEX, GUIDE_TOPICS, GUIDES } from './content.js';

/** Tools that hand an assistant the Wassist how-to knowledge it would otherwise fetch from the web. */
export const guideTools = [
  defineTool({
    name: 'wassist_guide',
    title: 'Read a Wassist workflow guide',
    description:
      'Read a short guide to a Wassist workflow: first steps, giving an agent tools and handoffs, trying an agent in a test chat, automated test runs with simulated customers, the shared sandbox number, connecting a real number, or the messaging window. Call with no topic to list them.',
    effect: 'read',
    input: z.strictObject({
      topic: z
        .enum(GUIDE_TOPICS)
        .optional()
        .describe('The guide to read. Leave out to get the list of topics.'),
    }),
    output: z.object({
      topics: z.array(z.enum(GUIDE_TOPICS)),
      guide: z.string(),
    }),
    run: async ({ topic }) => ({
      topics: [...GUIDE_TOPICS],
      guide: topic === undefined ? GUIDE_INDEX : GUIDES[topic],
    }),
  }),
];
