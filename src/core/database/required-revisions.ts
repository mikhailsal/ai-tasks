import type { JsonValue } from '../../schema/values.js';
import { domainError, normalizeError, type DomainError } from '../errors.js';
import { revisionSources, type RevisionField } from '../diagnostics/hints.js';

/** Revision values a mutation needs, in guard order (spec 004 R4; reused by spec 005 help). */
export type RevisionRequirements = {
  settings?: boolean | 'recurring' | undefined;
  entity?: boolean | undefined;
  config?: boolean | undefined;
};

export function requiredRevisions(
  requirements: RevisionRequirements,
  options: { recurring?: boolean } = {},
): RevisionField[] {
  const fields: RevisionField[] = ['operation_id', 'database_epoch'];
  if (requirements.settings === true) fields.push('expected_settings_revision');
  if (requirements.entity) fields.push('expected_revision');
  if (requirements.config !== false) fields.push('expected_config_revision');
  // The recurring settings check runs after the generic guards today, so it is listed last
  // and `details.field` keeps naming the same first problem as before.
  if (requirements.settings === 'recurring' && options.recurring)
    fields.push('expected_settings_revision');
  return fields;
}

function present(input: unknown, field: string): boolean {
  return (
    typeof input === 'object' &&
    input !== null &&
    !Array.isArray(input) &&
    Reflect.get(input, field) !== undefined
  );
}

export function missingRevisions(
  input: unknown,
  fields: readonly RevisionField[],
): RevisionField[] {
  return fields.filter((field) => !present(input, field));
}

/** One refusal that lists every missing value with where to read it (spec 004 FR-007). */
export function missingRevisionsError(
  missing: readonly RevisionField[],
  base: Record<string, JsonValue> = {},
): DomainError {
  const list = missing.map((field) => {
    const source = revisionSources[field];
    return { field, source };
  });
  const text = list
    .map((entry) =>
      'command' in entry.source ? `${entry.field} (${entry.source.command})` : entry.field,
    )
    .join(', ');
  return domainError('VALIDATION_ERROR', `Missing required values: ${text}`, {
    ...base,
    field: missing[0] ?? null,
    missing: list,
  });
}

/** Adapters parse the envelope before core; missing tokens are listed together (spec 004 FR-007). */
export function envelopeRefusal(rawInput: unknown, error: unknown): DomainError {
  const normalized = normalizeError(error);
  const missing = missingRevisions(rawInput, ['operation_id', 'database_epoch']);
  if (missing.length === 0) return normalized;
  const details =
    typeof normalized.details === 'object' &&
    normalized.details !== null &&
    !Array.isArray(normalized.details)
      ? normalized.details
      : {};
  return missingRevisionsError(missing, details);
}
