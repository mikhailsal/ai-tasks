import { domainError } from '../errors.js';

/** Which revision values a mutation needs (spec 005 R3). `entity` names what `expected_revision`
 * guards, so its source command differs. Guards and help both read this one table. */
export type RevisionRequirements = {
  settings?: true | 'recurring';
  entity?: 'task' | 'project' | 'config';
  config?: false;
  projectRequired?: false;
};

const task = { entity: 'task' } as const;
const recurringTask = { entity: 'task', settings: 'recurring' } as const;
const scheduledTask = { entity: 'task', settings: true } as const;

export const mutationRequirements = {
  'project.create': { config: false, projectRequired: false },
  'project.update': { entity: 'project' },
  'project.archive': { entity: 'project' },
  'project.restore': { entity: 'project' },
  'config.migrate': { entity: 'config' },
  'task.create': { settings: 'recurring' },
  'task.update': task,
  'task.transition': recurringTask,
  'task.position': recurringTask,
  'task.archive': recurringTask,
  'task.restore': recurringTask,
  'dependency.add': task,
  'dependency.remove': task,
  'occurrence.complete': scheduledTask,
  'occurrence.cancel': task,
  'occurrence.miss': scheduledTask,
  'recurrence.configure': scheduledTask,
  'recurrence.control': scheduledTask,
  'recurrence.tick': { settings: true },
  'settings.update': { settings: true },
  'backup.create': { settings: true },
  'backup.restore': { settings: true },
} as const satisfies Record<string, RevisionRequirements>;

export type MutationOperation = keyof typeof mutationRequirements;

/** Real operations read the table. Only an operation outside it (test harnesses) may state its
 * own requirements, so a production mutation cannot drift from its help. */
export function requirementsFor(
  operation: string,
  declared?: RevisionRequirements,
): RevisionRequirements {
  const known = Object.entries(mutationRequirements).find(([name]) => name === operation)?.[1];
  if (known && declared)
    throw domainError('INTERNAL_ERROR', 'Listed mutations take requirements from the table');
  const requirements = known ?? declared;
  if (!requirements)
    throw domainError('INTERNAL_ERROR', 'Mutation has no declared revision requirements');
  return requirements;
}
