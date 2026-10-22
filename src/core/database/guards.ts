import { eq } from 'drizzle-orm';
import * as z from 'zod/mini';
import { projects, tasks } from '../../schema/entities.js';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import { uuidSchema } from '../../schema/values.js';
import { domainError } from '../errors.js';
import type { CoreContext, DatabaseTransaction } from './types.js';
export const mutationGuardsSchema = z.strictObject({
  config: z.optional(z.boolean()),
  settings: z.optional(z.boolean()),
  projectRequired: z.optional(z.boolean()),
  entity: z.optional(z.strictObject({ type: z.enum(['task', 'project']), id: uuidSchema })),
});
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
    entity: NonNullable<z.infer<typeof mutationGuardsSchema>['entity']>;
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
function enforceProjectGuards(
  transaction: DatabaseTransaction,
  options: {
    projectSlug: string;
    input: MutationEnvelope;
    guards: z.infer<typeof mutationGuardsSchema>;
    settingsRevision: number;
  },
) {
  const { projectSlug, input, guards, settingsRevision } = options;
  const project = transaction.select().from(projects).where(eq(projects.slug, projectSlug)).get();
  if (!project) throw domainError('PROJECT_NOT_FOUND', 'The requested project does not exist');
  const entityRow = guards.entity
    ? checkEntity(transaction, { projectSlug, entity: guards.entity })
    : undefined;
  // Ownership is checked first. A timezone version also bumps its parent, so report
  // the changed schedule interpretation before the resulting stale parent revision.
  if (guards.settings)
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
  if (guards.config !== false)
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
  options: {
    context: CoreContext;
    projectSlug: string;
    input: MutationEnvelope;
    guards: z.infer<typeof mutationGuardsSchema>;
    settingsRevision: number;
  },
): void {
  const { context, projectSlug, input, guards, settingsRevision } = options;
  if (context.actor !== 'human-web' && context.actor !== `ai-cli:${projectSlug}`) {
    throw domainError('VALIDATION_ERROR', 'Actor does not match the explicit project scope');
  }
  if (guards.projectRequired !== false) {
    enforceProjectGuards(transaction, { projectSlug, input, guards, settingsRevision });
  } else if (guards.entity || guards.config !== false) {
    throw domainError('INTERNAL_ERROR', 'New-project guard configuration is invalid');
  }
  if (guards.settings && guards.projectRequired === false)
    checkRevision({
      expected: input.expected_settings_revision,
      current: settingsRevision,
      field: 'expected_settings_revision',
      scope: 'settings',
    });
}
