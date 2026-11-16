import { eq } from 'drizzle-orm';
import { valueDeclarationsSchema, type ValueDeclaration } from '../../schema/occurrence-values.js';
import { recurrenceState } from '../../schema/recurrence.js';
import type { JsonValue } from '../../schema/values.js';
import type { DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';

/** The declared values of a recurring task (spec 008 R4); none when nothing is declared. */
export function readDeclarations(
  transaction: DatabaseTransaction,
  taskId: string,
): ValueDeclaration[] {
  const stored = transaction
    .select({ value: recurrenceState.valueDeclarations })
    .from(recurrenceState)
    .where(eq(recurrenceState.taskId, taskId))
    .get()?.value;
  return stored === null || stored === undefined ? [] : valueDeclarationsSchema.parse(stored);
}

export function writeDeclarations(
  transaction: DatabaseTransaction,
  taskId: string,
  declarations: ValueDeclaration[],
): void {
  transaction
    .update(recurrenceState)
    .set({ valueDeclarations: declarations.length === 0 ? null : declarations })
    .where(eq(recurrenceState.taskId, taskId))
    .run();
}

const kindRules = {
  number: {
    expected: 'a finite number',
    valid: (value: number | string) => typeof value === 'number' && Number.isFinite(value),
  },
  time_of_day: {
    expected: 'a time of day HH:MM',
    valid: (value: number | string) =>
      typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value),
  },
  duration: {
    expected: 'whole minutes from 0 to 10080',
    valid: (value: number | string) =>
      typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10080,
  },
} as const;

/**
 * Checks values sent with a completion against the declarations current now, and returns them
 * as stored: each value keeps its kind (FR-004, FR-006).
 */
export function recordedValues(
  declarations: readonly ValueDeclaration[],
  input: Record<string, number | string>,
): Record<string, JsonValue> {
  const allowed = declarations.map((entry) => `${entry.name} (${entry.kind})`);
  const stored: Record<string, JsonValue> = {};
  for (const [name, value] of Object.entries(input)) {
    const declared = declarations.find((entry) => entry.name === name);
    if (!declared)
      throw domainError(
        'VALIDATION_ERROR',
        declarations.length === 0
          ? `This task declares no values; "${name}" cannot be recorded`
          : `"${name}" is not a declared value. Declared: ${allowed.join(', ')}`,
        { field: `values.${name}`, allowed },
      );
    const rule = kindRules[declared.kind];
    if (!rule.valid(value))
      throw domainError(
        'VALIDATION_ERROR',
        `"${name}" is a ${declared.kind} value: expected ${rule.expected}`,
        { field: `values.${name}`, kind: declared.kind, allowed },
      );
    stored[name] = { kind: declared.kind, value };
  }
  return stored;
}
