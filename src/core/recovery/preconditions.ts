import { restoreInputSchema, type AffectedProject } from '../../schema/recovery.js';
import { confirmationSchema } from '../../schema/tasks.js';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import { checkRevision } from '../database/guards.js';
import type { CoreContext } from '../database/types.js';
import { domainError } from '../errors.js';
import { parseInput } from '../validation.js';
import { recoveryMutation, guardRecoveryMutation } from './guards.js';
import { assertReadableAuditRecords } from './history.js';
import { validateBackup } from './validation.js';
import type { BackupOptions } from './backup.js';

function validateAffectedProjects(claimed: AffectedProject[], expected: AffectedProject[]) {
  const bySlug = new Map(claimed.map((project) => [project.project_slug, project]));
  if (bySlug.size !== claimed.length || claimed.length !== expected.length)
    throw domainError(
      'VALIDATION_ERROR',
      'Review the complete union of current and backup projects',
    );
  for (const project of expected) {
    const claim = bySlug.get(project.project_slug);
    if (!claim) throw domainError('VALIDATION_ERROR', 'The affected project union is incomplete');
    if (project.expected_revision === null || claim.expected_revision === null) {
      if (
        claim.expected_revision !== project.expected_revision ||
        claim.expected_config_revision !== project.expected_config_revision
      )
        throw domainError('VALIDATION_ERROR', 'Only absent current projects have null revisions');
      continue;
    }
    checkRevision({
      expected: claim.expected_revision,
      current: project.expected_revision,
      field: 'expected_revision',
      scope: project.project_slug,
    });
    // Both revisions were validated as a nullable pair at the shared schema boundary.
    if (project.expected_config_revision === null || claim.expected_config_revision === null)
      throw domainError('VALIDATION_ERROR', 'Current project configuration revisions are required');
    checkRevision({
      expected: claim.expected_config_revision,
      current: project.expected_config_revision,
      field: 'expected_config_revision',
      scope: project.project_slug,
    });
  }
}

/** Every current audit page must be readable before a checkpoint, migration or domain write. */
export function assertReadableAudit(context: Pick<CoreContext, 'connection'>): void {
  assertReadableAuditRecords(context.connection.sqlite);
}

export async function validateRestore(
  context: CoreContext,
  projectSlug: string,
  envelope: MutationEnvelope,
  options: BackupOptions = {},
) {
  const request = recoveryMutation(context, projectSlug, envelope, 'backup.restore');
  guardRecoveryMutation(context, request.project, request.input);
  const input = parseInput(restoreInputSchema, request.input.payload);
  const confirmation = confirmationSchema.safeParse(input.confirmation);
  if (!confirmation.success)
    throw domainError(
      'CONFIRMATION_REQUIRED',
      'Explicit restoration confirmation text is required',
    );
  assertReadableAudit(context);
  const validation = await validateBackup(context, input.backup_id, options);
  validateAffectedProjects(input.affected_projects, validation.data.affected_projects);
  guardRecoveryMutation(context, request.project, request.input);
  return { request, input, confirmation: confirmation.data, validation };
}
