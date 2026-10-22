import { and, eq } from 'drizzle-orm';
import { ordinaryWorkflowSchema, recurringWorkflowSchema } from '../../schema/configuration.js';
import { taskDependencies } from '../../schema/dependencies.js';
import {
  projectConfigs,
  projects,
  projectEmojiReservations,
  tasks,
} from '../../schema/entities.js';
import type { DatabaseTransaction } from '../database/types.js';
import { DomainError, domainError } from '../errors.js';
import { validateDependencyGraph } from '../tasks/dependency-graph.js';
import { DEFAULT_TASK_EMOJI } from '../tasks/emoji.js';
import type { MigrationPlan } from './migration-types.js';
import { validateRecurringMigration } from './migration-recurrence.js';

function readCurrentTasks(transaction: DatabaseTransaction) {
  return transaction
    .select({
      id: tasks.id,
      slug: tasks.projectSlug,
      kind: tasks.kind,
      statusId: tasks.statusId,
      emojiKey: tasks.emojiKey,
      archivedAt: tasks.archivedAt,
      revision: tasks.revision,
    })
    .from(tasks)
    .all();
}

type CurrentTask = ReturnType<typeof readCurrentTasks>[number];

function validateMembers(plan: MigrationPlan, rows: CurrentTask[]): void {
  const expected = new Map(
    plan.tasks.filter((task) => task.changed).map((task) => [task.before.id, task.before]),
  );
  const current = new Map(rows.map((task) => [task.id, task]));
  const seen = new Set<string>();
  for (const member of plan.input.affected_tasks) {
    if (seen.has(member.task_id)) {
      plan.issues.push({ code: 'VALIDATION_ERROR', message: 'Affected task IDs must be distinct' });
      continue;
    }
    seen.add(member.task_id);
    const row = current.get(member.task_id);
    if (!row) {
      plan.issues.push({
        code: 'TASK_NOT_FOUND',
        message: 'An affected task does not exist',
        task_id: member.task_id,
      });
    } else if (row.slug !== plan.project.slug) {
      plan.issues.push({
        code: 'PROJECT_MISMATCH',
        message: 'An affected task belongs to another project',
        task_id: row.id,
      });
    } else if (!expected.has(row.id)) {
      plan.issues.push({
        code: 'VALIDATION_ERROR',
        message: 'An unchanged task is not an affected migration member',
        task_id: row.id,
      });
    } else if (row.revision !== member.expected_revision) {
      plan.issues.push({
        code: 'REVISION_CONFLICT',
        message: 'An affected task changed since preview',
        task_id: row.id,
      });
    }
  }
  if ([...expected.keys()].some((id) => !seen.has(id)))
    plan.issues.push({
      code: 'VALIDATION_ERROR',
      message: 'Supply every affected task revision, including archived tasks',
    });
}

function currentCategoryMaps(transaction: DatabaseTransaction) {
  const configurations = transaction
    .select({
      slug: projects.slug,
      ordinary: projectConfigs.ordinaryWorkflow,
      recurring: projectConfigs.recurringWorkflow,
    })
    .from(projects)
    .leftJoin(
      projectConfigs,
      and(
        eq(projectConfigs.projectSlug, projects.slug),
        eq(projectConfigs.revision, projects.configRevision),
      ),
    )
    .all();
  return new Map(
    configurations.map((row) => {
      const ordinary = ordinaryWorkflowSchema.safeParse(row.ordinary);
      const recurring = recurringWorkflowSchema.safeParse(row.recurring);
      return [
        row.slug,
        {
          ordinary: ordinary.success
            ? new Map(ordinary.data.statuses.map((status) => [status.id, status.category]))
            : undefined,
          recurring: recurring.success
            ? new Map(recurring.data.statuses.map((status) => [status.id, status.category]))
            : undefined,
        },
      ];
    }),
  );
}

function projectedRows(
  transaction: DatabaseTransaction,
  plan: MigrationPlan,
  current: CurrentTask[],
) {
  const projected = new Map(plan.tasks.map((task) => [task.before.id, task]));
  const categories = currentCategoryMaps(transaction);
  return current.map((row) => {
    const replacement = projected.get(row.id);
    if (replacement)
      return {
        ...row,
        archivedAt: replacement.after.archivedAt,
        category: replacement.category,
        unresolved: replacement.unresolved,
      };
    const category = categories.get(row.slug)?.[row.kind]?.get(row.statusId);
    if (category === undefined)
      throw domainError('INTERNAL_ERROR', 'A stored task configuration is unavailable');
    return { ...row, category, unresolved: false };
  });
}

function validatePrerequisites(
  transaction: DatabaseTransaction,
  plan: MigrationPlan,
  rows: ReturnType<typeof projectedRows>,
): void {
  const guarded = new Set(
    plan.tasks
      .filter(
        (task) =>
          task.before.kind === 'ordinary' &&
          !task.unresolved &&
          (task.before.statusId !== task.after.statusId || task.oldCategory !== task.category) &&
          ['in_progress', 'review', 'completed'].includes(task.category),
      )
      .map((task) => task.before.id),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const link of transaction.select().from(taskDependencies).all()) {
    if (!guarded.has(link.dependentTaskId)) continue;
    if (byId.get(link.prerequisiteTaskId)?.category !== 'completed')
      plan.issues.push({
        code: 'DEPENDENCY_BLOCKED',
        message: 'A mapped advanced task requires completed prerequisites in the projected state',
        task_id: link.dependentTaskId,
      });
  }
}

function validateMarkers(
  transaction: DatabaseTransaction,
  plan: MigrationPlan,
  rows: ReturnType<typeof projectedRows>,
): void {
  const projectKeys = new Set(
    transaction
      .select({ key: projectEmojiReservations.emojiKey })
      .from(projectEmojiReservations)
      .all()
      .map((row) => row.key),
  );
  for (const project of transaction.select({ key: projects.emojiKey }).from(projects).all())
    projectKeys.add(project.key);
  const reserved = new Set<string>();
  for (const row of rows) {
    if (row.emojiKey === DEFAULT_TASK_EMOJI || row.unresolved) continue;
    const active =
      row.archivedAt === null && !['completed', 'cancelled', 'archived'].includes(row.category);
    const key = `${row.slug}:${row.emojiKey}`;
    if (projectKeys.has(row.emojiKey) || (active && reserved.has(key)))
      plan.issues.push({
        code: 'EMOJI_CONFLICT',
        message: 'The projected task marker is already reserved',
        task_id: row.id,
      });
    if (active) reserved.add(key);
  }
}

/** Side-effect-free validation over the entire projected state; never stages a preview write. */
export function validateMigrationPlan(transaction: DatabaseTransaction, plan: MigrationPlan): void {
  if (plan.project.archivedAt !== null)
    plan.issues.push({ code: 'VALIDATION_ERROR', message: 'Archived projects are read-only' });
  const current = readCurrentTasks(transaction);
  validateMembers(plan, current);
  try {
    validateDependencyGraph(transaction);
    const rows = projectedRows(transaction, plan, current);
    validatePrerequisites(transaction, plan, rows);
    validateMarkers(transaction, plan, rows);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    plan.issues.push({ code: error.code, message: error.message });
  }
  validateRecurringMigration(transaction, plan);
}
