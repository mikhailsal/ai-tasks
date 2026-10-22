import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  mutationSuccessEnvelopeSchema,
  type MutationEnvelope,
  type MutationSuccessEnvelope,
} from '../../schema/envelopes.js';
import { operationReceipts } from '../../schema/history.js';
import { jsonValueSchema, type JsonValue } from '../../schema/values.js';
import type { DatabaseTransaction } from '../database/types.js';
import { domainError, DomainError } from '../errors.js';

function invalidFingerprint(): DomainError {
  return domainError('VALIDATION_ERROR', 'Mutation identity must contain supported JSON values');
}

function encodeObject(value: object, ancestors: Set<object>): string {
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw invalidFingerprint();
  }
  if (Object.getOwnPropertySymbols(value).length > 0) throw invalidFingerprint();
  const entries: string[] = [];
  for (const key of Object.keys(value).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) throw invalidFingerprint();
    const encoded = encodeCanonical(descriptor.value, ancestors);
    if (encoded !== undefined) entries.push(`${JSON.stringify(key)}:${encoded}`);
  }
  return `{${entries.join(',')}}`;
}

function encodeCanonical(value: unknown, ancestors: Set<object>): string | undefined {
  if (value === undefined) return;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalidFingerprint();
    return JSON.stringify(value);
  }
  if (typeof value !== 'object' || ancestors.has(value)) throw invalidFingerprint();
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${Array.from(value, (entry) => encodeCanonical(entry, ancestors) ?? 'null').join(',')}]`;
    }
    return encodeObject(value, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

export function fingerprintRequest(request: {
  operation: string;
  project_slug: string;
  actor: string;
  origin: string;
  input: MutationEnvelope;
  target: JsonValue;
}): string {
  try {
    const encoded = encodeCanonical(request, new Set());
    if (encoded === undefined) throw invalidFingerprint();
    return createHash('sha256').update(encoded).digest('hex');
  } catch (error) {
    if (error instanceof DomainError) throw error;
    // Cycles, getters, proxies, or other unsupported values must not leak raw input.
    throw invalidFingerprint();
  }
}

function corruptReceipt(): DomainError {
  return domainError('INTERNAL_ERROR', 'Stored mutation receipt is invalid');
}

export function findReceipt(
  transaction: DatabaseTransaction,
  input: {
    database_epoch: string;
    operation_id: string;
    request_hash: string;
  },
): MutationSuccessEnvelope | undefined {
  let receipt;
  try {
    receipt = transaction
      .select()
      .from(operationReceipts)
      .where(
        and(
          eq(operationReceipts.databaseEpoch, input.database_epoch),
          eq(operationReceipts.operationId, input.operation_id),
        ),
      )
      .get();
  } catch (error) {
    if (error instanceof SyntaxError) throw corruptReceipt();
    throw error;
  }
  if (!receipt) return;
  if (receipt.requestHash !== input.request_hash) {
    throw domainError(
      'IDEMPOTENCY_CONFLICT',
      'Operation ID was already used with different content',
    );
  }
  const result = mutationSuccessEnvelopeSchema.safeParse(receipt.result);
  if (
    !result.success ||
    result.data.meta.database_epoch !== input.database_epoch ||
    result.data.meta.operation_id !== input.operation_id ||
    JSON.stringify(result.data.meta.audit_ids) !== JSON.stringify(receipt.auditIds)
  ) {
    throw corruptReceipt();
  }
  return result.data;
}

export function storeReceipt(
  transaction: DatabaseTransaction,
  input: {
    request_hash: string;
    actor: string;
    project_slug: string;
    operation: string;
    result: MutationSuccessEnvelope;
    committed_at: number;
  },
): void {
  const result = mutationSuccessEnvelopeSchema.safeParse(input.result);
  if (!result.success) throw corruptReceipt();
  transaction
    .insert(operationReceipts)
    .values({
      databaseEpoch: result.data.meta.database_epoch,
      operationId: result.data.meta.operation_id,
      requestHash: input.request_hash,
      actor: input.actor,
      projectSlug: input.project_slug,
      operation: input.operation,
      result: jsonValueSchema.parse(JSON.parse(JSON.stringify(result.data))),
      auditIds: result.data.meta.audit_ids,
      committedAt: input.committed_at,
    })
    .run();
}
