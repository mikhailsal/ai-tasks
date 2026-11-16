import type { CommandDescriptor } from '../types.js';

/** Informational and operational top-level commands. */
export const coreCommands: CommandDescriptor[] = [
  {
    path: ['help'],
    purpose:
      'Show the command index, a family, or one command with fields, revisions and an example.',
    kind: 'informational',
    scope: 'none',
    positional: [{ name: 'command...', description: 'Optional command words' }],
    options: ['json'],
    example: {
      argv: ['help', 'task', 'create', '--json'],
      placeholders: {},
      fixture: 'no_database',
      fixture_note: 'no database is needed',
    },
  },
  {
    path: ['version'],
    purpose: 'Show the application version.',
    kind: 'informational',
    scope: 'none',
    options: ['json'],
    example: {
      argv: ['version', '--json'],
      placeholders: {},
      fixture: 'no_database',
      fixture_note: 'no database is needed',
    },
  },
  {
    path: ['meta'],
    purpose: 'Read global metadata: schema version, timezone and the database epoch.',
    kind: 'read',
    scope: 'all_projects',
    options: ['json', 'allProjects', 'project', 'input'],
    example: {
      argv: ['meta', '--all-projects', '--json'],
      placeholders: {},
      fixture: 'empty_project',
      fixture_note: 'a migrated database',
    },
  },
  {
    path: ['serve'],
    purpose: 'Start the API and web interface and keep running until stopped.',
    kind: 'operational',
    scope: 'all_projects',
    options: ['json', 'allProjects', 'project'],
    example: {
      argv: ['serve', '--all-projects', '--json'],
      placeholders: {},
      fixture: 'empty_project',
      fixture_note: 'a migrated database; the command runs until stopped',
    },
  },
  {
    path: ['worker', 'run'],
    purpose: 'Run the recurring-work worker for one project until stopped.',
    kind: 'operational',
    scope: 'project',
    options: ['json', 'project', 'allProjects'],
    example: {
      argv: ['worker', 'run', '--project', 'demo', '--json'],
      placeholders: {},
      fixture: 'empty_project',
      fixture_note: 'a migrated database with the project demo; the command runs until stopped',
    },
  },
];
