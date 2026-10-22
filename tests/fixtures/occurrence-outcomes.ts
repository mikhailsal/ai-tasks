import { randomUUID } from 'node:crypto';
import { z } from 'zod/mini';
import { expect } from 'vitest';
import { createTask } from '../../src/core/tasks/commands.js';
import { formatTimestamp } from '../../src/core/time.js';
import type { CoreContext } from '../../src/core/database/types.js';
import {
  mutationSuccessEnvelopeSchema,
  type MutationEnvelope,
  type MutationSuccessEnvelope,
} from '../../src/schema/envelopes.js';
import { taskDetailSchema } from '../../src/schema/tasks.js';
import { jsonValueSchema, type JsonValue } from '../../src/schema/values.js';
import { ordinaryInput, ordinarySnapshot, type OrdinaryFixture } from './ordinary-work.js';
export type OutcomeCommand = (
  context: CoreContext,
  slug: string,
  id: string,
  input: MutationEnvelope,
) => unknown;
export async function outcomeApi() {
  const completePath = '../../src/core/recurrence/complete.js';
  const cancelPath = '../../src/core/recurrence/cancel.js';
  const tickPath = '../../src/core/recurrence/tick.js';
  const callable = z.custom<OutcomeCommand>((value) => typeof value === 'function');
  const [completion, cancellation, ticking] = await Promise.all([
    import(completePath),
    import(cancelPath),
    import(tickPath),
  ]);
  const complete = z.object({ completeOccurrences: callable }).parse(completion);
  const cancel = z.object({ cancelOccurrences: callable }).parse(cancellation);
  const tick = z
    .object({
      tickRecurrence: z.custom<
        (context: CoreContext, slug: string, input: MutationEnvelope) => unknown
      >((value) => typeof value === 'function'),
    })
    .parse(ticking);
  return {
    complete: (...args: Parameters<OutcomeCommand>) =>
      mutationSuccessEnvelopeSchema.parse(complete.completeOccurrences(...args)),
    cancel: (...args: Parameters<OutcomeCommand>) =>
      mutationSuccessEnvelopeSchema.parse(cancel.cancelOccurrences(...args)),
    tick: (context: CoreContext, slug: string, input: MutationEnvelope) =>
      mutationSuccessEnvelopeSchema.parse(tick.tickRecurrence(context, slug, input)),
  };
}
export function recurrenceInput(now: number, policy = 'carry_forward', window = 0) {
  return {
    first_deadline: formatTimestamp(now),
    schedule: { mode: 'after_completion', unit: 'hours', every: 1 },
    miss_policy: policy,
    confirmation_window_ms: window,
  };
}
export const occurrenceRowSchema = z.object({
  id: z.uuid(),
  task_id: z.uuid(),
  project_slug: z.string(),
  generation_id: z.uuid(),
  occurrence_key: z.string(),
  deadline: z.number(),
  expires_at: z.number(),
  state: z.string(),
  revision: z.number(),
  actual_completed_at: z.nullable(z.number()),
  completion_recorded_at: z.nullable(z.number()),
  missed_at: z.nullable(z.number()),
  cancelled_at: z.nullable(z.number()),
  cancel_reason: z.nullable(z.string()),
  description_snapshot: z.string(),
  description_html_snapshot: z.string(),
  schedule_snapshot: z.string(),
});
export type OccurrenceRow = z.infer<typeof occurrenceRowSchema>;
export function occurrenceRows(fixture: OrdinaryFixture, parent: string) {
  return z
    .array(occurrenceRowSchema)
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT * FROM occurrences WHERE task_id = ? ORDER BY deadline, id')
        .all(parent),
    );
}
export function parentRevision(fixture: OrdinaryFixture, id: string): number {
  return z
    .number()
    .parse(
      fixture.connection.sqlite.prepare('SELECT revision FROM tasks WHERE id = ?').pluck().get(id),
    );
}
export function outcomeInput(
  fixture: OrdinaryFixture,
  parent: string,
  payload: JsonValue,
  overrides: Partial<MutationEnvelope> = {},
): MutationEnvelope {
  return {
    ...ordinaryInput(fixture, payload, { revision: parentRevision(fixture, parent) }),
    expected_settings_revision: z
      .number()
      .parse(
        fixture.connection.sqlite
          .prepare('SELECT revision FROM application_state WHERE id = 1')
          .pluck()
          .get(),
      ),
    ...overrides,
  };
}
/** Real persisted setup isolates outcomes from the separately tested activation command.
 * It creates the parent through production task creation, then inserts valid storage rows. */
export function seedOutcomeParent(
  fixture: OrdinaryFixture,
  options: {
    slug?: string;
    emoji?: string;
    mode?: 'calendar' | 'after_completion';
    policy?: 'carry_forward' | 'record_miss';
    window?: number;
    status?: 'active' | 'paused';
    deadline?: number;
  } = {},
) {
  const slug = options.slug ?? 'alpha';
  const task = taskDetailSchema.parse(
    createTask(
      fixture.human,
      slug,
      ordinaryInput(
        fixture,
        {
          kind: 'ordinary',
          title: 'Повторяемая работа',
          description: '# Снимок\n\nТочный исходник  ',
          emoji: options.emoji ?? '⚪',
        },
        { projectSlug: slug },
      ),
    ).data,
  );
  const now = fixture.clock.now();
  const deadline = options.deadline ?? now;
  const generation = randomUUID();
  const mode = options.mode ?? 'after_completion';
  const schedule =
    mode === 'calendar'
      ? { mode, pattern: 'days', every: 1, local_time: '13:00:00.123' }
      : { mode, unit: 'hours', every: 1 };
  const policy = options.policy ?? 'carry_forward';
  const window = options.window ?? 0;
  const sqlite = fixture.connection.sqlite;
  sqlite
    .prepare('UPDATE tasks SET kind = ?, status_id = ? WHERE id = ?')
    .run('recurring', options.status ?? 'active', task.id);
  sqlite
    .prepare(
      `INSERT INTO schedule_generations
    (id,task_id,project_slug,generation_number,mode,schedule,first_deadline,timezone,miss_policy,window_ms,created_at)
    VALUES (?,?,?,1,?,?,?,'Europe/Moscow',?,?,?)`,
    )
    .run(generation, task.id, slug, mode, JSON.stringify(schedule), deadline, policy, window, now);
  sqlite
    .prepare(
      `INSERT INTO recurrence_state
    (task_id,project_slug,current_generation_id,cursor_anchor,next_candidate_at)
    VALUES (?,?,?,?,?)`,
    )
    .run(task.id, slug, generation, deadline, null);
  sqlite
    .prepare(
      `INSERT INTO recurrence_intervals
    (id,task_id,project_slug,start_at,behavior,schedule_generation_id) VALUES (?,?,?,?,?,?)`,
    )
    .run(
      randomUUID(),
      task.id,
      slug,
      Math.min(deadline, now),
      options.status ?? 'active',
      generation,
    );
  return { id: task.id, generation, slug, deadline, schedule, policy, window };
}
export type OutcomeParent = ReturnType<typeof seedOutcomeParent>;
export function seedOccurrence(
  fixture: OrdinaryFixture,
  parent: OutcomeParent,
  options: {
    deadline?: number;
    state?: 'pending' | 'debt' | 'missed';
    key?: string;
  } = {},
) {
  const id = randomUUID();
  const deadline = options.deadline ?? parent.deadline;
  const state = options.state ?? 'pending';
  const scheduleSnapshot = {
    generation_id: parent.generation,
    generation_number: 1,
    schedule: parent.schedule,
    timezone: 'Europe/Moscow',
    first_deadline: formatTimestamp(parent.deadline),
    miss_policy: parent.policy,
    confirmation_window_ms: parent.window,
  };
  fixture.connection.sqlite
    .prepare(
      `INSERT INTO occurrences
    (id,task_id,project_slug,generation_id,occurrence_key,deadline,expires_at,schedule_snapshot,
    miss_policy,confirmation_window_ms,description_snapshot,description_html_snapshot,
    render_policy_version,state,missed_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
    )
    .run(
      id,
      parent.id,
      parent.slug,
      parent.generation,
      options.key ?? `seed:${id}`,
      deadline,
      deadline + parent.window,
      JSON.stringify(scheduleSnapshot),
      parent.policy,
      parent.window,
      '# Снимок\n\nТочный исходник  ',
      '<h1>Снимок</h1>\n<p>Точный исходник</p>\n',
      state,
      state === 'pending' ? null : deadline + parent.window,
      fixture.clock.now(),
    );
  if (parent.schedule.mode === 'after_completion')
    fixture.connection.sqlite
      .prepare('UPDATE recurrence_state SET waiting_predecessor_id = ? WHERE task_id = ?')
      .run(id, parent.id);
  return occurrenceRowSchema.parse(
    fixture.connection.sqlite.prepare('SELECT * FROM occurrences WHERE id = ?').get(id),
  );
}
export function outcomeSnapshot(fixture: OrdinaryFixture) {
  return {
    ...ordinarySnapshot(fixture),
    ...Object.fromEntries(
      [
        'schedule_generations',
        'occurrences',
        'recurrence_state',
        'recurrence_intervals',
        'task_dependencies',
      ].map((table) => [
        table,
        fixture.connection.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ]),
    ),
  };
}
export function selection(rows: OccurrenceRow[], actual?: number) {
  return {
    occurrences: rows.map((row) => ({
      id: row.id,
      expected_revision: row.revision,
      ...(actual === undefined ? {} : { actual_completed_at: formatTimestamp(actual) }),
    })),
  };
}
export function assertOutcomeCommit(fixture: OrdinaryFixture, result: MutationSuccessEnvelope) {
  expect(result.meta.audit_ids.length).toBeGreaterThan(0);
  const receipt = z
    .object({ result: z.string(), audit_ids: z.string() })
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT result, audit_ids FROM operation_receipts WHERE operation_id = ?')
        .get(result.meta.operation_id),
    );
  expect(JSON.parse(receipt.result)).toEqual(result);
  expect(JSON.parse(receipt.audit_ids)).toEqual(result.meta.audit_ids);
  const events = z
    .array(
      z.object({
        id: z.string(),
        operation_id: z.string(),
        changes: z.string(),
        entity_id: z.string(),
        config_snapshot: z.nullable(z.string()),
        timestamp: z.number(),
      }),
    )
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT * FROM audit_records WHERE operation_id = ? ORDER BY rowid')
        .all(result.meta.operation_id),
    );
  expect(events.map((event) => event.id)).toEqual(result.meta.audit_ids);
  for (const event of events) {
    expect(event.timestamp).toBe(fixture.clock.now());
    expect(jsonValueSchema.parse(JSON.parse(event.changes))).toBeDefined();
  }
  return events;
}
