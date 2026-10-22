import { z } from 'zod/mini';
import type { CoreContext } from '../../src/core/database/types.js';
import { createProject } from '../../src/core/projects/commands.js';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import { createTask, archiveTask } from '../../src/core/tasks/commands.js';
import {
  mutationSuccessEnvelopeSchema,
  type MutationEnvelope,
} from '../../src/schema/envelopes.js';
import { jsonValueSchema, type JsonValue } from '../../src/schema/values.js';
import { auditBrowserServer } from './audit-browser.js';
import { ordinaryInput, type OrdinaryFixture } from './ordinary-work.js';
export async function recurrenceBrowserServer(restoreConsent = false) {
  const server = await auditBrowserServer();
  try {
    server.fixture.clock.set(Date.now());
    const config = createDefaultProjectConfig();
    if (restoreConsent)
      config.recurring_workflow.transitions = config.recurring_workflow.transitions.map((edge) => ({
        ...edge,
        requires_confirmation: edge.from === 'archived' && edge.to === 'paused',
      }));
    createProject(
      server.fixture.human,
      'alpha',
      ordinaryInput(
        server.fixture,
        jsonValueSchema.parse({ slug: 'alpha', name: 'Повторения', emoji: '🪴', config }),
      ),
    );
    return server;
  } catch (error) {
    await server.close();
    throw error;
  }
}
export type RecurrenceBrowserServer = Awaited<ReturnType<typeof recurrenceBrowserServer>>;
type ParentCommand = (
  context: CoreContext,
  slug: string,
  id: string,
  input: MutationEnvelope,
) => unknown;
async function controlCommand() {
  const path = '../../src/core/recurrence/control.js';
  const loaded: unknown = await import(path);
  return z
    .object({ controlRecurrence: z.custom<ParentCommand>((value) => typeof value === 'function') })
    .parse(loaded).controlRecurrence;
}
export function browserParent(fixture: OrdinaryFixture, id: string) {
  return z
    .object({
      id: z.uuid(),
      revision: z.number(),
      status_id: z.string(),
      archived_at: z.nullable(z.number()),
    })
    .parse(fixture.connection.sqlite.prepare('SELECT * FROM tasks WHERE id=?').get(id));
}
export function browserRecurrenceInput(
  fixture: OrdinaryFixture,
  payload: JsonValue,
  id?: string,
): MutationEnvelope {
  return {
    ...ordinaryInput(fixture, payload, id ? { revision: browserParent(fixture, id).revision } : {}),
    expected_settings_revision: z
      .number()
      .parse(
        fixture.connection.sqlite
          .prepare('SELECT revision FROM application_state WHERE id=1')
          .pluck()
          .get(),
      ),
  };
}
export async function seedBrowserRecurring(
  server: RecurrenceBrowserServer,
  options: {
    first?: number;
    mode?: 'calendar' | 'after_completion';
    active?: boolean;
    activeSince?: number;
    policy?: 'carry_forward' | 'record_miss';
    archived?: boolean;
  } = {},
) {
  const fixture = server.fixture;
  fixture.clock.set(options.activeSince ?? Date.now());
  const first = options.first ?? fixture.clock.now() + 86400000;
  const recurrence = {
    first_deadline: new Date(first).toISOString(),
    schedule:
      options.mode === 'after_completion'
        ? { mode: 'after_completion', unit: 'hours', every: 1 }
        : { mode: 'calendar', pattern: 'days', every: 1, local_time: '13:00:00.000' },
    miss_policy: options.policy ?? 'carry_forward',
    confirmation_window_ms: 0,
  };
  const id = z.object({ id: z.uuid() }).parse(
    createTask(
      fixture.human,
      'alpha',
      browserRecurrenceInput(fixture, {
        kind: 'recurring',
        title: 'Проверка оборудования',
        description: '# Инструкция\n\n**Сохранённая** версия  ',
        recurrence,
      }),
    ).data,
  ).id;
  if (options.active) {
    const control = await controlCommand();
    fixture.clock.set(options.activeSince ?? Date.now());
    try {
      mutationSuccessEnvelopeSchema.parse(
        control(
          fixture.human,
          'alpha',
          id,
          browserRecurrenceInput(fixture, { to_status_id: 'active' }, id),
        ),
      );
    } finally {
      fixture.clock.set(Date.now());
    }
  }
  if (options.archived)
    archiveTask(fixture.human, 'alpha', id, browserRecurrenceInput(fixture, {}, id));
  return id;
}
export const browserOccurrenceSchema = z.object({
  id: z.uuid(),
  task_id: z.uuid(),
  state: z.string(),
  deadline: z.number(),
  revision: z.number(),
  description_snapshot: z.string(),
  schedule_snapshot: z.string(),
  cancel_reason: z.nullable(z.string()),
  actual_completed_at: z.nullable(z.number()),
  completion_recorded_at: z.nullable(z.number()),
});
export function browserOccurrences(server: RecurrenceBrowserServer, id: string) {
  return z
    .array(browserOccurrenceSchema)
    .parse(
      server.fixture.connection.sqlite
        .prepare('SELECT * FROM occurrences WHERE task_id=? ORDER BY deadline,id')
        .all(id),
    );
}
export function browserWriteSnapshot(server: RecurrenceBrowserServer) {
  return [
    'application_state',
    'tasks',
    'occurrences',
    'schedule_generations',
    'recurrence_intervals',
    'recurrence_state',
    'audit_records',
    'operation_receipts',
  ].map((table) =>
    server.fixture.connection.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  );
}
export async function changeBrowserTimezone(server: RecurrenceBrowserServer) {
  const path = '../../src/core/projects/settings.js';
  const loaded: unknown = await import(path);
  const command = z
    .object({
      updateSettings: z.custom<
        (context: CoreContext, slug: string, input: MutationEnvelope) => unknown
      >((value) => typeof value === 'function'),
    })
    .parse(loaded).updateSettings;
  return mutationSuccessEnvelopeSchema.parse(
    command(
      server.fixture.human,
      'alpha',
      browserRecurrenceInput(server.fixture, { timezone: 'Europe/Berlin' }),
    ),
  );
}
