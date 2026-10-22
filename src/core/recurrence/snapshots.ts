import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { tasks } from '../../schema/entities.js';
import { confirmationWindowSchema, scheduleSchema } from '../../schema/recurrence-input.js';
import { occurrences, type scheduleGenerations } from '../../schema/recurrence.js';
import { jsonValueSchema } from '../../schema/values.js';
import type { AuditEvent } from '../audit/append.js';
import type { DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { renderMarkdown, RENDER_POLICY_VERSION } from '../markdown/render.js';
import { formatTimestamp, readClock } from '../time.js';
import { parseInput } from '../validation.js';

export type OccurrenceRow = typeof occurrences.$inferSelect;

function nullableTimestamp(value: number | null) {
  return value === null ? null : formatTimestamp(value);
}

/** Public snapshots preserve provenance and use only the canonical rendered HTML field. */
export function occurrenceResource(row: OccurrenceRow) {
  return {
    id: row.id,
    task_id: row.taskId,
    project_slug: row.projectSlug,
    generation_id: row.generationId,
    occurrence_key: row.occurrenceKey,
    deadline: formatTimestamp(row.deadline),
    expires_at: formatTimestamp(row.expiresAt),
    state: row.state,
    revision: row.revision,
    description_snapshot: row.descriptionSnapshot,
    rendered_html_snapshot:
      row.renderPolicyVersion === RENDER_POLICY_VERSION
        ? row.descriptionHtmlSnapshot
        : renderMarkdown(row.descriptionSnapshot),
    render_policy_version: row.renderPolicyVersion,
    schedule_snapshot: row.scheduleSnapshot,
    miss_policy: row.missPolicy,
    confirmation_window_ms: row.confirmationWindowMs,
    actual_completed_at: nullableTimestamp(row.actualCompletedAt),
    completion_recorded_at: nullableTimestamp(row.completionRecordedAt),
    missed_at: nullableTimestamp(row.missedAt),
    cancelled_at: nullableTimestamp(row.cancelledAt),
    cancel_reason: row.cancelReason,
    created_at: formatTimestamp(row.createdAt),
  };
}

export function occurrenceEvent(
  before: OccurrenceRow | null,
  after: OccurrenceRow,
  action: string,
): AuditEvent {
  const previous = before === null ? null : occurrenceResource(before);
  const current = occurrenceResource(after);
  const changes = Object.entries(current)
    .filter(
      ([field, value]) =>
        previous === null || JSON.stringify(Reflect.get(previous, field)) !== JSON.stringify(value),
    )
    .map(([field, value]) => ({
      field,
      before: jsonValueSchema.parse(previous === null ? null : Reflect.get(previous, field)),
      after: jsonValueSchema.parse(value),
    }));
  return {
    entity_type: 'occurrence',
    entity_id: after.id,
    action,
    changes,
    config_snapshot: after.scheduleSnapshot,
  };
}

/** The caller owns the immediate mutation transaction and appends returned events atomically. */
export function materializeOccurrence(
  transaction: DatabaseTransaction,
  options: {
    task: typeof tasks.$inferSelect;
    generation: typeof scheduleGenerations.$inferSelect;
    deadline: number;
    key: string;
    now: number;
  },
): { row: OccurrenceRow; events: AuditEvent[] } {
  const { task, generation } = options;
  if (task.id !== generation.taskId || task.projectSlug !== generation.projectSlug)
    throw domainError(
      'PROJECT_MISMATCH',
      'The generation must belong to the requested task and project',
    );
  if (task.kind !== 'recurring')
    throw domainError('VALIDATION_ERROR', 'Only recurring tasks can materialize occurrences');
  const deadline = readClock(() => options.deadline);
  const now = readClock(() => options.now);
  const window = parseInput(confirmationWindowSchema, generation.windowMs);
  const expiresAt = readClock(() => deadline + window);
  const existing = transaction
    .select()
    .from(occurrences)
    .where(
      and(eq(occurrences.generationId, generation.id), eq(occurrences.occurrenceKey, options.key)),
    )
    .get();
  if (existing) {
    if (existing.deadline !== deadline)
      throw domainError(
        'VALIDATION_ERROR',
        'An occurrence key cannot identify a different deadline',
      );
    return { row: existing, events: [] };
  }
  // Elapsed successors are identified by their predecessor: equal valid actual
  // completion instants may derive equal deadlines for distinct obligations.
  if (
    generation.mode === 'calendar' &&
    transaction
      .select({ id: occurrences.id })
      .from(occurrences)
      .where(and(eq(occurrences.taskId, task.id), eq(occurrences.deadline, deadline)))
      .get()
  )
    throw domainError('VALIDATION_ERROR', 'This task already has an occurrence at that deadline');
  const snapshot = jsonValueSchema.parse({
    generation_id: generation.id,
    generation_number: generation.generationNumber,
    schedule: parseInput(scheduleSchema, generation.schedule),
    first_deadline: formatTimestamp(generation.firstDeadline),
    timezone: generation.timezone,
    miss_policy: generation.missPolicy,
    confirmation_window_ms: window,
  });
  const row = transaction
    .insert(occurrences)
    .values({
      id: randomUUID(),
      taskId: task.id,
      projectSlug: task.projectSlug,
      generationId: generation.id,
      occurrenceKey: options.key,
      deadline,
      expiresAt,
      scheduleSnapshot: snapshot,
      missPolicy: generation.missPolicy,
      confirmationWindowMs: window,
      descriptionSnapshot: task.description,
      descriptionHtmlSnapshot:
        task.renderPolicyVersion === RENDER_POLICY_VERSION
          ? task.descriptionHtml
          : renderMarkdown(task.description),
      renderPolicyVersion: RENDER_POLICY_VERSION,
      state: 'pending',
      revision: 1,
      createdAt: now,
    })
    .returning()
    .get();
  if (!row) throw domainError('INTERNAL_ERROR', 'Occurrence creation returned no result');
  return { row, events: [occurrenceEvent(null, row, 'occurrence.create')] };
}
