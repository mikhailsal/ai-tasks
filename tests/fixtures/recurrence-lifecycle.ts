import { z } from 'zod/mini';
import type { CoreContext } from '../../src/core/database/types.js';
import { createProject } from '../../src/core/projects/commands.js';
import { createTask } from '../../src/core/tasks/commands.js';
import {
  mutationEnvelopeSchema,
  mutationSuccessEnvelopeSchema,
  type MutationEnvelope,
} from '../../src/schema/envelopes.js';
import { jsonValueSchema, type JsonValue } from '../../src/schema/values.js';
import {
  createOrdinaryFixture,
  ordinaryInput,
  ordinarySnapshot,
  type OrdinaryFixture,
} from './ordinary-work.js';
type ParentMutation = (
  context: CoreContext,
  slug: string,
  id: string,
  input: MutationEnvelope,
) => unknown;
type ScopedMutation = (context: CoreContext, slug: string, input: MutationEnvelope) => unknown;
const parentFunction = z.custom<ParentMutation>((value) => typeof value === 'function');
const scopedFunction = z.custom<ScopedMutation>((value) => typeof value === 'function');
async function exportFrom(path: string, name: string): Promise<unknown> {
  const module: unknown = await import(path);
  return z.record(z.string(), z.unknown()).parse(module)[name];
}
/** Missing future exports remain implementation prerequisites, never behavioral RED evidence. */
export async function recurrenceApi() {
  const [control, tick, complete, cancel, settings, configure] = await Promise.all([
    exportFrom('../../src/core/recurrence/control.js', 'controlRecurrence'),
    exportFrom('../../src/core/recurrence/tick.js', 'tickRecurrence'),
    exportFrom('../../src/core/recurrence/complete.js', 'completeOccurrences'),
    exportFrom('../../src/core/recurrence/cancel.js', 'cancelOccurrences'),
    exportFrom('../../src/core/projects/settings.js', 'updateSettings'),
    exportFrom('../../src/core/recurrence/control.js', 'configureRecurrence'),
  ]);
  return {
    controlRecurrence: parentFunction.parse(control),
    tickRecurrence: scopedFunction.parse(tick),
    completeOccurrences: parentFunction.parse(complete),
    cancelOccurrences: parentFunction.parse(cancel),
    updateSettings: scopedFunction.parse(settings),
    configureRecurrence: parentFunction.parse(configure),
  };
}
export const day = 86400000;
export const calendarSchedule = {
  mode: 'calendar',
  pattern: 'days',
  every: 1,
  local_time: '13:00:00.123',
};
export const elapsedSchedule = { mode: 'after_completion', unit: 'days', every: 1 };
export function recurrenceInput(
  first: number,
  options: {
    elapsed?: boolean;
    policy?: 'carry_forward' | 'record_miss';
    window?: number;
  } = {},
) {
  return {
    first_deadline: new Date(first).toISOString(),
    schedule: options.elapsed ? elapsedSchedule : calendarSchedule,
    miss_policy: options.policy ?? 'record_miss',
    confirmation_window_ms: options.window ?? 0,
  };
}
export async function lifecycleFixture() {
  const fixture = await createOrdinaryFixture();
  createProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { slug: 'alpha', name: 'Повторения', emoji: '🔵' }),
  );
  return fixture;
}
export function parentRow(fixture: OrdinaryFixture, id: string) {
  return z
    .object({
      id: z.uuid(),
      revision: z.number(),
      status_id: z.string(),
      archived_at: z.nullable(z.number()),
    })
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT id, revision, status_id, archived_at FROM tasks WHERE id=?')
        .get(id),
    );
}
export function settingsRevision(fixture: OrdinaryFixture) {
  return z
    .number()
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT revision FROM application_state WHERE id=1')
        .pluck()
        .get(),
    );
}
export function recurrenceEnvelope(
  fixture: OrdinaryFixture,
  payload: JsonValue,
  id?: string,
  extra: Partial<MutationEnvelope> = {},
) {
  return mutationEnvelopeSchema.parse({
    ...ordinaryInput(
      fixture,
      payload,
      id === undefined ? {} : { revision: parentRow(fixture, id).revision },
    ),
    expected_settings_revision: settingsRevision(fixture),
    ...extra,
  });
}
export function createRecurring(
  fixture: OrdinaryFixture,
  first: number,
  options: Parameters<typeof recurrenceInput>[1] = {},
) {
  const result = createTask(
    fixture.human,
    'alpha',
    recurrenceEnvelope(fixture, {
      kind: 'recurring',
      title: 'Повторяющаяся работа',
      description: 'Исходное описание',
      recurrence: recurrenceInput(first, options),
    }),
  );
  return z.object({ id: z.uuid() }).parse(result.data).id;
}
export const occurrenceRowSchema = z.object({
  id: z.uuid(),
  task_id: z.uuid(),
  deadline: z.number(),
  expires_at: z.number(),
  state: z.enum(['pending', 'debt', 'missed', 'completed', 'completed_late', 'cancelled']),
  revision: z.number(),
  generation_id: z.uuid(),
  actual_completed_at: z.nullable(z.number()),
  completion_recorded_at: z.nullable(z.number()),
  missed_at: z.nullable(z.number()),
});
export function occurrenceRows(fixture: OrdinaryFixture, id: string) {
  return z
    .array(occurrenceRowSchema)
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT * FROM occurrences WHERE task_id=? ORDER BY deadline,id')
        .all(id),
    );
}
export function recurrenceSnapshot(fixture: OrdinaryFixture) {
  return {
    ...ordinarySnapshot(fixture),
    ...Object.fromEntries(
      ['schedule_generations', 'recurrence_state', 'recurrence_intervals', 'occurrences'].map(
        (table) => [
          table,
          fixture.connection.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        ],
      ),
    ),
  };
}
export function projectEnvelope(fixture: OrdinaryFixture, payload: JsonValue) {
  const revision = z
    .number()
    .parse(
      fixture.connection.sqlite
        .prepare("SELECT revision FROM projects WHERE slug='alpha'")
        .pluck()
        .get(),
    );
  return recurrenceEnvelope(fixture, payload, undefined, { expected_revision: revision });
}
export function allChildren(fixture: OrdinaryFixture) {
  return z
    .array(z.object({ task_id: z.uuid(), expected_revision: z.number() }))
    .parse(
      fixture.connection.sqlite
        .prepare(
          "SELECT id AS task_id, revision AS expected_revision FROM tasks WHERE project_slug='alpha' ORDER BY id",
        )
        .all(),
    );
}
export async function control(
  fixture: OrdinaryFixture,
  id: string,
  to: string,
  extra: Record<string, JsonValue> = {},
) {
  const api = await recurrenceApi();
  return mutationSuccessEnvelopeSchema.parse(
    api.controlRecurrence(
      fixture.human,
      'alpha',
      id,
      recurrenceEnvelope(fixture, { to_status_id: to, ...extra }, id),
    ),
  );
}
export async function tick(fixture: OrdinaryFixture, ids: string[]) {
  const api = await recurrenceApi();
  return mutationSuccessEnvelopeSchema.parse(
    api.tickRecurrence(
      fixture.human,
      'alpha',
      recurrenceEnvelope(fixture, {
        tasks: ids.map((task_id) => ({
          task_id,
          expected_revision: parentRow(fixture, task_id).revision,
        })),
      }),
    ),
  );
}
export function selected(fixture: OrdinaryFixture, id: string, state: 'future' | 'debt') {
  return occurrenceRows(fixture, id)
    .filter((row) =>
      state === 'future'
        ? row.state === 'pending' && row.deadline > fixture.clock.now()
        : row.state === 'debt',
    )
    .map((row) => ({ id: row.id, expected_revision: row.revision }));
}
export async function cancelFuture(fixture: OrdinaryFixture, id: string) {
  const api = await recurrenceApi();
  const occurrences = selected(fixture, id, 'future');
  if (occurrences.length === 0) return;
  api.cancelOccurrences(
    fixture.human,
    'alpha',
    id,
    recurrenceEnvelope(fixture, { occurrences, reason: 'Прекращение будущих окон' }, id),
  );
}
export function json(value: unknown) {
  return jsonValueSchema.parse(value);
}
