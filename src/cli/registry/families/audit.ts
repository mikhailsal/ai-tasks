import { pageOptions, readOptions } from '../option-sets.js';
import type { CommandDescriptor } from '../types.js';

export const auditCommands: CommandDescriptor[] = [
  {
    path: ['audit', 'list'],
    purpose: 'List immutable audit events by entity, operation and page in an explicit scope.',
    kind: 'read',
    scope: 'either',
    options: [...readOptions, 'entityId', 'operation', ...pageOptions],
    input: async () => (await import('../../../schema/audit.js')).auditListInputSchema,
    example: {
      argv: ['audit', 'list', '--project', 'demo', '--json'],
      placeholders: {},
      fixture: 'empty_project',
      fixture_note: 'a migrated database with project demo and its default configuration, no tasks',
    },
  },
];
