import type * as z from 'zod/mini';
import type { MutationOperation } from '../../core/database/mutation-requirements.js';
import type { CliOptions } from '../options.js';

/** Prepared states the help example runner can build (spec 005 R5). */
export type ExampleFixture =
  | 'no_database'
  | 'empty_project'
  | 'ordinary_task'
  | 'two_ordinary_tasks'
  | 'linked_tasks'
  | 'archived_task'
  | 'archived_project'
  | 'active_recurring_task'
  | 'paused_recurring_with_future'
  | 'managed_backup';

/** `{{name}}` in argv or input. Read placeholders name the command and response path that
 * supply them; `new_uuid` is generated. */
/**
 * Where a placeholder value comes from: a read command's response, a fresh UUID, or the
 * response of another command's own help example (for values only a mutation returns).
 */
export type Placeholder =
  { command: string; path: string } | { generate: 'uuid' } | { example: string; path: string };

export type CommandExample = {
  argv: string[];
  input?: Record<string, unknown>;
  placeholders: Record<string, Placeholder>;
  fixture: ExampleFixture;
  fixture_note: string;
};

export type CommandKind = 'read' | 'mutation' | 'operational' | 'informational';
export type CommandScope = 'project' | 'all_projects' | 'either' | 'none';

/** One leaf command (spec 005 data-model, CommandDescriptor). */
export type CommandDescriptor = {
  path: readonly string[];
  purpose: string;
  kind: CommandKind;
  scope: CommandScope;
  positional?: readonly { name: string; description: string }[];
  /** Allowed option keys; the action rejects all others (spec 004 FR-010). */
  options: readonly (keyof CliOptions)[];
  /** Lazy loader of the input schema whose fields the JSON input may carry. */
  input?: () => Promise<z.ZodMiniType>;
  /** Mutation whose revision requirements apply (core `mutationRequirements`). */
  mutation?: MutationOperation;
  example: CommandExample;
};
