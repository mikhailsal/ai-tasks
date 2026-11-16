import type { CommandDescriptor } from './types.js';

/** The flags a caller passes for each scope rule; reads always need one. */
export const scopeFlags: Record<CommandDescriptor['scope'], string> = {
  project: '--project SLUG (required)',
  all_projects: '--all-projects (required)',
  either: '--project SLUG or --all-projects (one is required)',
  none: 'none',
};
