import { and, eq, inArray, isNull } from 'drizzle-orm';
import { tasks } from '../../../schema/entities.js';
import { hint } from '../../diagnostics/hints.js';
import type { DatabaseConnection } from '../../database/types.js';
import { formatTimestamp } from '../../clock.js';
import { lastPasses, workerStatus } from '../../worker/status.js';
import type { AdvisoryProvider, Finding } from '../collect.js';
import { workflows } from './workflows.js';

type Database = DatabaseConnection['db'];
/** Reads whose completeness depends on the worker (spec 011 R4). */
const dependentOperations = new Set([
  'occurrence.list',
  'occurrence.get',
  'occurrence.progress',
  'recurrence.get',
  'agenda.list',
  'task.list',
  'task.get',
]);
const MAX_PROJECTS = 50;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Projects an all-projects response shows; a project-scoped read names its own. */
function projectsShown(data: unknown, found = new Set<string>()): Set<string> {
  if (found.size >= MAX_PROJECTS) return found;
  if (Array.isArray(data)) for (const item of data) projectsShown(item, found);
  else if (isObject(data)) {
    if (typeof data.project_slug === 'string') found.add(data.project_slug);
    for (const value of Object.values(data)) projectsShown(value, found);
  }
  return found;
}

/** Projects with at least one active recurring task: only they depend on the worker. */
function dependentProjects(database: Database, slugs: string[]): string[] {
  const workflowOf = workflows(database);
  const rows = database
    .select({ projectSlug: tasks.projectSlug, statusId: tasks.statusId })
    .from(tasks)
    .where(
      and(inArray(tasks.projectSlug, slugs), eq(tasks.kind, 'recurring'), isNull(tasks.archivedAt)),
    )
    .all();
  const dependent = new Set<string>();
  for (const row of rows) {
    const status = workflowOf(row.projectSlug).statuses.find((item) => item.id === row.statusId);
    if (status?.category === 'active') dependent.add(row.projectSlug);
  }
  return slugs.filter((slug) => dependent.has(slug));
}

function remedy(slug: string, last: number | undefined) {
  const when = last === undefined ? '' : ` Last pass ${formatTimestamp(last)}.`;
  return hint(
    'start_service',
    `Start the service (serve), which runs the worker; manual: worker run --project ${slug}.${when}`,
    { command: 'serve' },
  );
}

export function workerProvider(now: () => number): AdvisoryProvider {
  return (database, request) => {
    if (!dependentOperations.has(request.operation)) return [];
    const scope =
      request.projectSlug === null ? [...projectsShown(request.data)] : [request.projectSlug];
    if (scope.length === 0) return [];
    const projects = dependentProjects(database, scope);
    const passes = lastPasses(database, projects);
    return projects.flatMap((slug): Finding[] => {
      const last = passes.get(slug);
      const status = workerStatus(last ?? null, now());
      if (status === 'healthy') return [];
      return [
        {
          code: status === 'never' ? 'worker_never_ran' : 'worker_stale',
          remedy: remedy(slug, last),
          subject: { type: 'project', id: slug },
        },
      ];
    });
  };
}
