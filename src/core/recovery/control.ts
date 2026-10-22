import { z } from 'zod/mini';
import { domainError, errorEnvelope, normalizeError } from '../errors.js';
import { errorCodeSchema, errorDefinitions } from '../../schema/errors.js';
import { errorEnvelopeSchema, mutationEnvelopeSchema } from '../../schema/envelopes.js';
import { recoveryJobEnvelopeSchema } from '../../schema/recovery.js';
import { BODY_LIMIT_BYTES, jsonBodySchema, slugSchema } from '../../schema/values.js';
import type { JsonValue } from '../../schema/values.js';

export const SUPERVISOR_CONTROL_FRAME_BYTES = BODY_LIMIT_BYTES + 4_096;

const publicMutationEnvelopeSchema = mutationEnvelopeSchema.check(
  z.refine((value) => jsonBodySchema.safeParse(value).success, 'Mutation body exceeds 1 MiB'),
);

export const supervisorControlRequestSchema = z.strictObject({
  version: z.literal(1),
  type: z.literal('restore'),
  projectSlug: slugSchema,
  envelope: publicMutationEnvelopeSchema,
});
export const supervisorControlResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    result: recoveryJobEnvelopeSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    error: errorEnvelopeSchema.shape.error,
  }),
]);

export type SupervisorControlRequest = z.output<typeof supervisorControlRequestSchema>;
export type SupervisorControlResponse = z.output<typeof supervisorControlResponseSchema>;
export type SupervisorRecoveryJobEnvelope = z.output<typeof recoveryJobEnvelopeSchema>;
export type SupervisorRestoreSubmission = Pick<
  SupervisorControlRequest,
  'projectSlug' | 'envelope'
> & { caller: 'cli' };

export function supervisorControlFailure(error: unknown): SupervisorControlResponse {
  const normalized = normalizeError(error);
  const envelope = errorEnvelope(normalized);
  return supervisorControlResponseSchema.parse({ ok: false, error: envelope.error });
}

export function supervisorControlError(
  code: string,
  details: JsonValue = null,
  message?: string,
): Error {
  const parsedCode = errorCodeSchema.parse(code);
  // This is a validated private domain response, not a raw native/runtime error.
  // Preserve its full stable diagnostic through the CLI's normal error boundary.
  return domainError(parsedCode, message ?? errorDefinitions[parsedCode].message, details);
}
