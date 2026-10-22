import {
  configurationMigrationSchema,
  configurationPreviewEnvelopeSchema,
} from '../../schema/configuration-migration.js';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import { jsonBodySchema, jsonValueSchema } from '../../schema/values.js';
import { checkRevision } from '../database/guards.js';
import { executeMutation } from '../database/mutate.js';
import type { CoreContext, DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { queryMetadata, queryState } from '../queries/page.js';
import { readClock } from '../time.js';
import { parseInput } from '../validation.js';
import { buildMigrationPlan } from './migration-plan.js';
import { validateMigrationPlan } from './migration-validation.js';
import { applyMigration } from './migration-write.js';
import { requireProject } from './read.js';
import { hasRecurringBehaviorChanges } from './migration-recurrence.js';
import { recurrenceSettings } from '../recurrence/generations.js';

function prepareMigration(
  transaction: DatabaseTransaction,
  slug: string,
  payload: unknown,
  now: number,
) {
  const input = parseInput(configurationMigrationSchema, parseInput(jsonValueSchema, payload));
  const plan = buildMigrationPlan(transaction, slug, input, now);
  validateMigrationPlan(transaction, plan);
  return plan;
}

export function previewConfiguration(
  context: Pick<CoreContext, 'connection' | 'now'>,
  projectSlug: string,
  payload: unknown,
) {
  const body = parseInput(jsonBodySchema, payload);
  return context.connection.db.transaction((transaction) => {
    const state = queryState(transaction);
    const now = readClock(context.now);
    const plan = prepareMigration(transaction, projectSlug, body, now);
    return configurationPreviewEnvelopeSchema.parse({
      ok: true,
      data: {
        affected_tasks: plan.tasks
          .filter((task) => task.changed)
          .map((task) => ({ task_id: task.before.id, expected_revision: task.before.revision })),
        required_status_mappings: plan.requiredStatuses,
        required_priority_mappings: plan.requiredPriorities,
        issues: plan.issues,
      },
      meta: queryMetadata(state, now),
    });
  });
}

export function migrateConfiguration(
  context: CoreContext,
  projectSlug: string,
  input: MutationEnvelope,
) {
  return executeMutation({
    context,
    projectSlug,
    input,
    operation: 'config.migrate',
    handler(transaction, now) {
      const project = requireProject(transaction, projectSlug);
      checkRevision({
        expected: input.expected_revision,
        current: project.configRevision,
        field: 'expected_revision',
        scope: 'configuration',
        entityId: project.id,
      });
      const plan = prepareMigration(transaction, projectSlug, input.payload, now);
      if (hasRecurringBehaviorChanges(plan))
        checkRevision({
          expected: input.expected_settings_revision,
          current: recurrenceSettings(transaction).revision,
          field: 'expected_settings_revision',
          scope: 'settings',
        });
      const issue = plan.issues[0];
      if (issue)
        throw domainError(
          issue.code,
          issue.message,
          jsonValueSchema.parse({ issues: plan.issues }),
        );
      return applyMigration(transaction, plan, { now, actor: context.actor });
    },
  });
}
