import { eq } from 'drizzle-orm';
import * as z from 'zod/mini';
import { projects, tasks } from '../../schema/entities.js';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import { uuidSchema } from '../../schema/values.js';
import { domainError } from '../errors.js';
import type { RevisionRequirements } from './mutation-requirements.js';
import {
  missingRevisions,
  missingRevisionsError,
  requiredRevisions,
} from './required-revisions.js';
import type { CoreContext, DatabaseTransaction } from './types.js';
function payloadKind(payload: unknown): unknown {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? Reflect.get(payload, 'kind')
    : undefined;
}
/** Callers name only the guarded target; revision requirements come from the operation. */
export const mutationGuardsSchema = z.strictObject({
  entity: z.optional(z.strictObject({ type: z.enum(['task', 'project']), id: uuidSchema })),
});
type Guards = z.infer<typeof mutationGuardsSchema>;
export function checkRevision(options: {
  expected: number | undefined;
  current: number;
  field: string;
  scope: string;
  entityId?: string;
}): void {
  const { expected, current, field, scope, entityId } = options;
  if (expected === undefined) {
    throw domainError('VALIDATION_ERROR', 'A required revision is missing', { field });
  }
  if (expected === current) return;
  throw domainError(
    field === 'expected_revision' ? 'REVISION_CONFLICT' : 'CONFIG_CONFLICT',
    'The saved revision changed since it was read',
    { scope, entity_id: entityId ?? null, expected_revision: expected, current_revision: current },
  );
}
function checkEntity(
  transaction: DatabaseTransaction,
  options: {
    projectSlug: string;
    entity: NonNullable<Guards['entity']>;
  },
) {
  const { entity, projectSlug } = options;
  const row =
    entity.type === 'task'
      ? transaction.select().from(tasks).where(eq(tasks.id, entity.id)).get()
      : transaction.select().from(projects).where(eq(projects.id, entity.id)).get();
  if (!row)
    throw domainError(
      entity.type === 'task' ? 'TASK_NOT_FOUND' : 'PROJECT_NOT_FOUND',
      'The requested entity does not exist',
      { entity_id: entity.id },
    );
  const owner = 'projectSlug' in row ? row.projectSlug : row.slug;
  if (owner !== projectSlug)
    throw domainError('PROJECT_MISMATCH', 'The target belongs to another project', {
      entity_id: entity.id,
    });
  return row;
}
type GuardOptions = {
  projectSlug: string;
  input: MutationEnvelope;
  guards: Guards;
  requirements: RevisionRequirements;
  settingsRevision: number;
};
function enforceProjectGuards(transaction: DatabaseTransaction, options: GuardOptions) {
  const { projectSlug, input, guards, requirements, settingsRevision } = options;
  const project = transaction.select().from(projects).where(eq(projects.slug, projectSlug)).get();
  if (!project) throw domainError('PROJECT_NOT_FOUND', 'The requested project does not exist');
  const entityRow = guards.entity
    ? checkEntity(transaction, { projectSlug, entity: guards.entity })
    : undefined;
  const recurring =
    (entityRow !== undefined && 'kind' in entityRow && entityRow.kind === 'recurring') ||
    payloadKind(input.payload) === 'recurring';
  const missing = missingRevisions(input, requiredRevisions(requirements, { recurring }));
  if (missing.length > 0) throw missingRevisionsError(missing, {}, requirements);
  // Ownership is checked first. A timezone version also bumps its parent, so report
  // the changed schedule interpretation before the resulting stale parent revision.
  if (requirements.settings === true)
    checkRevision({
      expected: input.expected_settings_revision,
      current: settingsRevision,
      field: 'expected_settings_revision',
      scope: 'settings',
    });
  if (entityRow && guards.entity)
    checkRevision({
      expected: input.expected_revision,
      current: entityRow.revision,
      field: 'expected_revision',
      scope: guards.entity.type,
      entityId: guards.entity.id,
    });
  if (requirements.config !== false)
    checkRevision({
      expected: input.expected_config_revision,
      current: project.configRevision,
      field: 'expected_config_revision',
      scope: 'project',
      entityId: project.id,
    });
}
export function enforceMutationGuards(
  transaction: DatabaseTransaction,
  options: GuardOptions & { context: CoreContext },
): void {
  const { context, projectSlug, input, guards, requirements, settingsRevision } = options;
  if (context.actor !== 'human-web' && context.actor !== `ai-cli:${projectSlug}`) {
    throw domainError('VALIDATION_ERROR', 'Actor does not match the explicit project scope');
  }
  if (requirements.projectRequired !== false) {
    enforceProjectGuards(transaction, options);
    return;
  }
  if (guards.entity || requirements.config !== false || requirements.entity)
    throw domainError('INTERNAL_ERROR', 'New-project guard configuration is invalid');
  const missing = missingRevisions(input, requiredRevisions(requirements));
  if (missing.length > 0) throw missingRevisionsError(missing, {}, requirements);
  if (requirements.settings === true)
    checkRevision({
      expected: input.expected_settings_revision,
      current: settingsRevision,
      field: 'expected_settings_revision',
      scope: 'settings',
    });
}
