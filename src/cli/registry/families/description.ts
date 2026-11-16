import { readOptions } from '../option-sets.js';
import type { CommandDescriptor } from '../types.js';

export const descriptionCommands: CommandDescriptor[] = [
  {
    path: ['description', 'preview'],
    purpose: 'Render saved-description Markdown to sanitized HTML without saving it.',
    kind: 'read',
    scope: 'project',
    options: readOptions,
    input: async () => (await import('../../../core/markdown/preview.js')).previewInputSchema,
    example: {
      argv: ['description', 'preview', '--project', 'demo', '--input', '-', '--json'],
      input: { description: '# Heading\n\nSome **bold** text.' },
      placeholders: {},
      fixture: 'empty_project',
      fixture_note: 'a migrated database with project demo and its default configuration, no tasks',
    },
  },
];
