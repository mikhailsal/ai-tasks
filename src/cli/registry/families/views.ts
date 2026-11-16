import { readOptions } from '../option-sets.js';
import type { CommandDescriptor } from '../types.js';

const filters = ['q', 'status', 'category', 'kind', 'emoji', 'archive', 'includeTerminal'] as const;
const pagedOptions = [
  ...readOptions,
  ...filters,
  'limit',
  'cursor',
  'deadlinePreset',
  'deadlineDay',
] as const;
const fixture = {
  fixture: 'empty_project',
  fixture_note: 'a migrated database with the project demo',
} as const;
const schemas = () => import('../../../schema/read-views.js');

export const viewsCommands: CommandDescriptor[] = [
  {
    path: ['agenda'],
    purpose: 'Read tasks grouped by project into local calendar buckets at one captured instant.',
    kind: 'read',
    scope: 'either',
    options: pagedOptions,
    input: async () => (await schemas()).agendaInputSchema,
    example: { argv: ['agenda', '--project', 'demo', '--json'], placeholders: {}, ...fixture },
  },
  {
    path: ['priorities'],
    purpose: 'Read tasks ordered by priority within each project and its configured model.',
    kind: 'read',
    scope: 'either',
    options: pagedOptions,
    input: async () => (await schemas()).prioritiesInputSchema,
    example: { argv: ['priorities', '--project', 'demo', '--json'], placeholders: {}, ...fixture },
  },
  {
    path: ['stats'],
    purpose: 'Read separate task and occurrence counts; JSON from/to bounds are half-open.',
    kind: 'read',
    scope: 'either',
    options: [...readOptions, ...filters],
    input: async () => (await schemas()).statisticsInputSchema,
    example: { argv: ['stats', '--project', 'demo', '--json'], placeholders: {}, ...fixture },
  },
];
