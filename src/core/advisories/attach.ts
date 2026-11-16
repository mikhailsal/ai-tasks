import type { Advisory } from '../../schema/advisories.js';
import { successEnvelopeSchema } from '../../schema/envelopes.js';
import type { DatabaseConnection } from '../database/types.js';
import { collectAdvisories, type AdvisoryProvider, type AdvisoryRequest } from './collect.js';
import { readinessProvider } from './providers/readiness.js';

/** Registered providers, in no particular order: the catalogue orders the output. */
export const advisoryProviders: readonly AdvisoryProvider[] = [readinessProvider];

/**
 * Adds advisories to a success envelope from current state (spec 010 R3). Anything that is not
 * a success envelope passes through untouched, and so does a response nothing applies to.
 */
export function adviseFor(
  database: DatabaseConnection['db'],
  request: Omit<AdvisoryRequest, 'data'>,
  value: unknown,
  providers: readonly AdvisoryProvider[] = advisoryProviders,
): { advisories?: Advisory[]; advisories_omitted?: number } {
  const envelope = successEnvelopeSchema.safeParse(value);
  if (!envelope.success || envelope.data.advisories !== undefined) return {};
  return collectAdvisories(database, { ...request, data: envelope.data.data }, providers);
}
export function attachAdvisories(
  database: DatabaseConnection['db'],
  request: Omit<AdvisoryRequest, 'data'>,
  value: unknown,
  providers: readonly AdvisoryProvider[] = advisoryProviders,
): unknown {
  const found = adviseFor(database, request, value, providers);
  return found.advisories === undefined
    ? value
    : { ...successEnvelopeSchema.parse(value), ...found };
}
