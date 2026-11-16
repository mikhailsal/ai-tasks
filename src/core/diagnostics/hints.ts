import { hintActions } from '../../schema/diagnostics.js';

/** Corrective next steps (spec 004 data-model, Hint). The action list is closed. */
export { hintActions };
export type HintAction = (typeof hintActions)[number];

export type Hint = { action: HintAction; text: string; command?: string; field?: string };

export function hint(
  action: HintAction,
  text: string,
  extra: { command?: string; field?: string } = {},
): Hint {
  return { action, text: text.slice(0, 200), ...extra };
}

/** Where each revision value is read (spec 004 R4, shared with spec 005 help). */
export const revisionSources = {
  operation_id: hint('read_revision', 'Generate a new UUID for every new change', {
    field: 'operation_id',
  }),
  database_epoch: hint('read_revision', 'Read meta.database_epoch from any read response', {
    command: 'meta',
    field: 'database_epoch',
  }),
  expected_revision: hint('read_revision', 'Read data.revision of the entity you change', {
    command: 'task get',
    field: 'expected_revision',
  }),
  expected_config_revision: hint('read_revision', 'Read data.revision from config get', {
    command: 'config get',
    field: 'expected_config_revision',
  }),
  expected_settings_revision: hint('read_revision', 'Read data.revision from settings get', {
    command: 'settings get',
    field: 'expected_settings_revision',
  }),
} as const satisfies Record<string, Hint>;
export type RevisionField = keyof typeof revisionSources;
