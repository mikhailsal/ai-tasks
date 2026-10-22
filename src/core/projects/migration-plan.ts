import { eq } from 'drizzle-orm';
import { tasks } from '../../schema/entities.js';
import { priorityValueSchema, validatePriorityForModel } from '../../schema/configuration.js';
import type { ConfigurationMigration } from '../../schema/configuration-migration.js';
import type { DatabaseTransaction } from '../database/types.js';
import { requireProject, readProjectConfiguration } from './read.js';
import { priorityColumns } from './priorities.js';
import { requireWorkflowStatus, workflowFor } from './workflows.js';
import type { MigrationPlan, ProjectedTask, StoredTask } from './migration-types.js';

function invalid(plan: MigrationPlan, message: string): void {
  plan.issues.push({ code: 'VALIDATION_ERROR', message });
}

function statusKey(kind: string, status: string): string {
  return `${kind}:${status}`;
}

function priorityKey(value: unknown): string {
  return JSON.stringify(priorityValueSchema.parse(value));
}

function statusMappings(plan: MigrationPlan, rows: StoredTask[]) {
  const used = new Set(rows.map((task) => statusKey(task.kind, task.statusId)));
  const mappings = new Map<string, string>();
  for (const mapping of plan.input.status_mappings) {
    const key = statusKey(mapping.kind, mapping.from_status_id);
    if (mappings.has(key)) invalid(plan, 'Status mappings must have distinct sources');
    if (!used.has(key)) invalid(plan, 'A status mapping source is not in use');
    const target = workflowFor(plan.input.config, mapping.kind).statuses.find(
      (status) => status.id === mapping.to_status_id,
    );
    if (!target) invalid(plan, 'A status mapping target does not exist');
    mappings.set(key, mapping.to_status_id);
  }
  return mappings;
}

function priorityMappings(plan: MigrationPlan, rows: StoredTask[]) {
  const used = new Set(rows.map((task) => priorityKey(task.priority)));
  const mappings = new Map<string, ReturnType<typeof priorityValueSchema.parse>>();
  for (const mapping of plan.input.priority_mappings) {
    const key = priorityKey(mapping.from);
    if (mappings.has(key)) invalid(plan, 'Priority mappings must have distinct sources');
    if (!used.has(key)) invalid(plan, 'A priority mapping source is not in use');
    try {
      validatePriorityForModel(mapping.to, plan.input.config.priority_model);
      mappings.set(key, mapping.to);
    } catch {
      invalid(plan, 'A priority mapping target is incompatible with the new model');
    }
  }
  return mappings;
}

function projectStatus(plan: MigrationPlan, task: StoredTask, mappings: Map<string, string>) {
  const old = requireWorkflowStatus(plan.previous, task.kind, task.statusId);
  const statuses = workflowFor(plan.input.config, task.kind).statuses;
  const current = statuses.find((status) => status.id === task.statusId);
  const mandatory = !current || current.category !== old.category;
  const key = statusKey(task.kind, task.statusId);
  const mapped = mappings.get(key);
  if (mandatory) plan.requiredStatuses.push({ kind: task.kind, from_status_id: task.statusId });
  const target = statuses.find((status) => status.id === (mapped ?? task.statusId));
  const unresolved = (mandatory && mapped === undefined) || target === undefined;
  if (unresolved) invalid(plan, 'Supply an explicit valid mapping for each changed status meaning');
  return { old, target: target ?? old, unresolved };
}

function projectPriority(
  plan: MigrationPlan,
  task: StoredTask,
  mappings: ReturnType<typeof priorityMappings>,
) {
  const key = priorityKey(task.priority);
  let mandatory = false;
  try {
    validatePriorityForModel(task.priority, plan.input.config.priority_model);
  } catch {
    mandatory = true;
    plan.requiredPriorities.push({ from: priorityValueSchema.parse(task.priority) });
  }
  const unresolved = mandatory && !mappings.has(key);
  if (unresolved) invalid(plan, 'Supply an explicit valid mapping for each incompatible priority');
  const value = mappings.has(key) ? mappings.get(key) : task.priority;
  const columns = unresolved
    ? { priority: task.priority, priorityScaled: task.priorityScaled }
    : priorityColumns(value, plan.input.config.priority_model);
  return { columns, unresolved };
}

function projectTask(
  plan: MigrationPlan,
  task: StoredTask,
  mappings: { statuses: Map<string, string>; priorities: ReturnType<typeof priorityMappings> },
): ProjectedTask {
  const status = projectStatus(plan, task, mappings.statuses);
  const priority = projectPriority(plan, task, mappings.priorities);
  const unresolved = status.unresolved || priority.unresolved;
  const changed =
    unresolved ||
    status.target.id !== task.statusId ||
    status.target.category !== status.old.category ||
    priorityKey(priority.columns.priority) !== priorityKey(task.priority);
  return {
    before: task,
    after: {
      ...task,
      statusId: status.target.id,
      ...priority.columns,
      archivedAt:
        task.kind !== 'recurring' || unresolved
          ? task.archivedAt
          : status.target.category === 'archived'
            ? (task.archivedAt ?? plan.now)
            : status.old.category === 'archived'
              ? null
              : task.archivedAt,
    },
    oldCategory: status.old.category,
    category: status.target.category,
    changed,
    unresolved,
  };
}

function uniqueRequirements(plan: MigrationPlan): void {
  plan.requiredStatuses = [
    ...new Map(
      plan.requiredStatuses.map((mapping) => [
        statusKey(mapping.kind, mapping.from_status_id),
        mapping,
      ]),
    ).values(),
  ].sort((a, b) => {
    const left = statusKey(a.kind, a.from_status_id);
    const right = statusKey(b.kind, b.from_status_id);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  plan.requiredPriorities = [
    ...new Map(
      plan.requiredPriorities.map((mapping) => [priorityKey(mapping.from), mapping]),
    ).values(),
  ];
}

/** Plans only in memory. Preview and commit read the same transaction snapshot. */
export function buildMigrationPlan(
  transaction: DatabaseTransaction,
  projectSlug: string,
  input: ConfigurationMigration,
  now: number,
): MigrationPlan {
  const project = requireProject(transaction, projectSlug);
  const plan: MigrationPlan = {
    now,
    project,
    previous: readProjectConfiguration(transaction, project),
    input,
    tasks: [],
    requiredStatuses: [],
    requiredPriorities: [],
    issues: [],
  };
  const rows = transaction
    .select()
    .from(tasks)
    .where(eq(tasks.projectSlug, projectSlug))
    .orderBy(tasks.id)
    .all();
  const mappings = {
    statuses: statusMappings(plan, rows),
    priorities: priorityMappings(plan, rows),
  };
  plan.tasks = rows.map((task) => projectTask(plan, task, mappings));
  uniqueRequirements(plan);
  return plan;
}
