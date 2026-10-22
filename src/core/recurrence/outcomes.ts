import { eq, inArray } from 'drizzle-orm';
import { tasks } from '../../schema/entities.js';
import { occurrences } from '../../schema/recurrence.js';
import { jsonValueSchema } from '../../schema/values.js';
import type { AuditEvent } from '../audit/append.js';
import { checkRevision } from '../database/guards.js';
import type { DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { readProjectConfiguration, requireProject } from '../projects/read.js';
import { assertProjectActive, taskStatus } from '../tasks/read.js';
import { requireRecurring } from './generations.js';
import { occurrenceResource, type OccurrenceRow } from './snapshots.js';

export function occurrenceCommandContext(
  transaction: DatabaseTransaction,
  projectSlug: string,
  taskId: string,
) {
  const project = requireProject(transaction, projectSlug);
  assertProjectActive(project);
  const task = requireRecurring(transaction, projectSlug, taskId);
  if (task.archivedAt !== null)
    throw domainError('VALIDATION_ERROR', 'Archived tasks are read-only');
  const config = readProjectConfiguration(transaction, project);
  const status = taskStatus(task, config);
  return { task, project, config, status };
}
export type OccurrenceCommandContext = ReturnType<typeof occurrenceCommandContext>;

/** Resolve every selection and version before either command starts changing outcomes. */
export function selectOccurrences(
  transaction: DatabaseTransaction,
  options: {
    task: OccurrenceCommandContext['task'];
    selected: { id: string; expected_revision: number }[];
  },
) {
  const rows = new Map<string, OccurrenceRow>();
  for (let offset = 0; offset < options.selected.length; offset += 200) {
    const ids = options.selected.slice(offset, offset + 200).map((item) => item.id);
    for (const row of transaction
      .select()
      .from(occurrences)
      .where(inArray(occurrences.id, ids))
      .all())
      rows.set(row.id, row);
  }
  return options.selected.map((selected) => {
    const row = rows.get(selected.id);
    if (!row)
      throw domainError('TASK_NOT_FOUND', 'The selected occurrence does not exist', {
        entity_id: selected.id,
      });
    if (row.projectSlug !== options.task.projectSlug || row.taskId !== options.task.id)
      throw domainError(
        'PROJECT_MISMATCH',
        'The selected occurrence belongs to another parent or project',
        { entity_id: row.id },
      );
    checkRevision({
      expected: selected.expected_revision,
      current: row.revision,
      field: 'expected_revision',
      scope: 'occurrence',
      entityId: row.id,
    });
    return row;
  });
}

export function finishOccurrenceCommand(
  transaction: DatabaseTransaction,
  options: {
    context: OccurrenceCommandContext;
    rows: OccurrenceRow[];
    events: AuditEvent[];
    now: number;
    action: 'occurrence.complete' | 'occurrence.cancel';
    advanceParent?: boolean;
  },
) {
  const { task, project, config } = options.context;
  const events = [...options.events];
  let revision = task.revision;
  if (options.advanceParent !== false) {
    revision++;
    transaction
      .update(tasks)
      .set({ revision, updatedAt: options.now })
      .where(eq(tasks.id, task.id))
      .run();
    events.push({
      entity_type: 'task',
      entity_id: task.id,
      action: options.action,
      changes: [{ field: 'revision', before: task.revision, after: revision }],
      config_snapshot: jsonValueSchema.parse({ revision: project.configRevision, ...config }),
    });
  }
  return {
    data: jsonValueSchema.parse({
      task_id: task.id,
      task_revision: revision,
      occurrences: options.rows.map(occurrenceResource),
    }),
    events,
  };
}
