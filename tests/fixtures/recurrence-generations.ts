import { z } from 'zod/mini';
import { createReadContext } from '../../src/core/context.js';
import type { CoreContext } from '../../src/core/database/types.js';
import { createProject } from '../../src/core/projects/commands.js';
import { createTask } from '../../src/core/tasks/commands.js';
import { mutationEnvelopeSchema, type MutationEnvelope } from '../../src/schema/envelopes.js';
import { jsonValueSchema, type JsonValue } from '../../src/schema/values.js';
import {
  createOrdinaryFixture,
  ordinaryInput,
  ordinarySnapshot,
  type OrdinaryFixture,
} from './ordinary-work.js';
type ParentCommand = (
  context: CoreContext,
  slug: string,
  id: string,
  envelope: MutationEnvelope,
) => unknown;
type ProjectCommand = (context: CoreContext, slug: string, envelope: MutationEnvelope) => unknown;
type RecurrenceRead = (
  context: ReturnType<typeof createReadContext>,
  slug: string,
  id: string,
) => unknown;
const parentCommand = z.custom<ParentCommand>((value) => typeof value === 'function');
const projectCommand = z.custom<ProjectCommand>((value) => typeof value === 'function');
/** Future implementation prerequisites are separate from the compiled behavior RED. */
export async function generationApi() {
  const controlPath = '../../src/core/recurrence/control.js';
  const tickPath = '../../src/core/recurrence/tick.js';
  const completePath = '../../src/core/recurrence/complete.js';
  const [control, tick, complete]: unknown[] = await Promise.all([
    import(controlPath),
    import(tickPath),
    import(completePath),
  ]);
  return {
    ...z
      .object({ configureRecurrence: parentCommand, controlRecurrence: parentCommand })
      .parse(control),
    ...z.object({ tickRecurrence: projectCommand }).parse(tick),
    ...z.object({ completeOccurrences: parentCommand }).parse(complete),
  };
}
export async function generationSettings() {
  const path = '../../src/core/projects/settings.js';
  const loaded: unknown = await import(path);
  return z.object({ updateSettings: projectCommand }).parse(loaded).updateSettings;
}
export async function generationRead() {
  const path = '../../src/core/queries/recurrence.js';
  const loaded: unknown = await import(path);
  return z
    .object({ getRecurrence: z.custom<RecurrenceRead>((value) => typeof value === 'function') })
    .parse(loaded).getRecurrence;
}
export const dayMs = 86400000;
export const daily = { mode: 'calendar', pattern: 'days', every: 1, local_time: '13:00:00.123' };
export const elapsed = { mode: 'after_completion', unit: 'days', every: 1 };
export function rule(
  first: number,
  options: {
    schedule?: JsonValue;
    policy?: 'carry_forward' | 'record_miss';
    window?: number;
  } = {},
) {
  return {
    first_deadline: new Date(first).toISOString(),
    schedule: options.schedule ?? daily,
    miss_policy: options.policy ?? 'carry_forward',
    confirmation_window_ms: options.window ?? 60000,
  };
}
export async function generationFixture() {
  const fixture = await createOrdinaryFixture();
  createProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { slug: 'alpha', name: 'Поколения расписаний', emoji: '🌀' }),
  );
  return fixture;
}
export function taskRevision(fixture: OrdinaryFixture, id: string) {
  return z
    .int()
    .check(z.positive())
    .parse(
      fixture.connection.sqlite.prepare('SELECT revision FROM tasks WHERE id=?').pluck().get(id),
    );
}
export function generationInput(fixture: OrdinaryFixture, payload: JsonValue, id?: string) {
  return mutationEnvelopeSchema.parse({
    ...ordinaryInput(
      fixture,
      payload,
      id === undefined ? {} : { revision: taskRevision(fixture, id) },
    ),
    expected_settings_revision: z
      .number()
      .parse(
        fixture.connection.sqlite
          .prepare('SELECT revision FROM application_state WHERE id=1')
          .pluck()
          .get(),
      ),
  });
}
export function createRecurring(fixture: OrdinaryFixture, recurrence: ReturnType<typeof rule>) {
  const result = createTask(
    fixture.human,
    'alpha',
    generationInput(fixture, {
      kind: 'recurring',
      title: 'Проверка поколений',
      description: '**Снимок** исходного текста',
      recurrence,
    }),
  );
  return z.object({ id: z.uuid() }).parse(result.data).id;
}
const generationRow = z.object({
  id: z.uuid(),
  task_id: z.uuid(),
  generation_number: z.number(),
  mode: z.string(),
  schedule: z.string(),
  timezone: z.string(),
  first_deadline: z.number(),
  miss_policy: z.string(),
  window_ms: z.number(),
  successor_generation_id: z.nullable(z.uuid()),
});
export function generations(fixture: OrdinaryFixture, id: string) {
  return z
    .array(generationRow)
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT * FROM schedule_generations WHERE task_id=? ORDER BY generation_number')
        .all(id),
    );
}
const occurrenceRow = z.object({
  id: z.uuid(),
  generation_id: z.uuid(),
  occurrence_key: z.string(),
  deadline: z.number(),
  expires_at: z.number(),
  state: z.string(),
  revision: z.number(),
  actual_completed_at: z.nullable(z.number()),
  completion_recorded_at: z.nullable(z.number()),
  missed_at: z.nullable(z.number()),
  schedule_snapshot: z.string(),
  description_snapshot: z.string(),
  description_html_snapshot: z.string(),
  miss_policy: z.string(),
  confirmation_window_ms: z.number(),
});
export function occurrences(fixture: OrdinaryFixture, id: string) {
  return z
    .array(occurrenceRow)
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT * FROM occurrences WHERE task_id=? ORDER BY deadline,id')
        .all(id),
    );
}
export function checkpoint(fixture: OrdinaryFixture, id: string) {
  return z
    .object({
      current_generation_id: z.uuid(),
      cursor_anchor: z.nullable(z.number()),
      waiting_predecessor_id: z.nullable(z.uuid()),
      next_candidate_at: z.nullable(z.number()),
      revision: z.number(),
    })
    .parse(
      fixture.connection.sqlite.prepare('SELECT * FROM recurrence_state WHERE task_id=?').get(id),
    );
}
export function generationSnapshot(fixture: OrdinaryFixture) {
  return {
    ...ordinarySnapshot(fixture),
    ...Object.fromEntries(
      ['schedule_generations', 'occurrences', 'recurrence_state', 'recurrence_intervals'].map(
        (table) => [
          table,
          fixture.connection.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        ],
      ),
    ),
  };
}
export function readContext(fixture: OrdinaryFixture) {
  return createReadContext({ connection: fixture.connection, now: fixture.clock.now });
}
export async function activate(fixture: OrdinaryFixture, id: string) {
  const api = await generationApi();
  api.controlRecurrence(
    fixture.human,
    'alpha',
    id,
    generationInput(fixture, { to_status_id: 'active' }, id),
  );
  return api;
}
export function tickInput(fixture: OrdinaryFixture, id: string) {
  return generationInput(fixture, {
    tasks: [{ task_id: id, expected_revision: taskRevision(fixture, id) }],
  });
}
export function asJson(value: unknown) {
  return jsonValueSchema.parse(value);
}
