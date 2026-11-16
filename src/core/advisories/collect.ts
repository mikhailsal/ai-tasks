import { MAX_ADVISORIES, type Advisory, type AdvisorySubject } from '../../schema/advisories.js';
import type { Hint } from '../diagnostics/hints.js';
import type { DatabaseConnection } from '../database/types.js';
import { advisoryCatalogue, advisoryCodes, type AdvisoryCode } from './catalogue.js';

/** What a provider may look at: the request, the response data and current state. */
export type AdvisoryRequest = {
  operation: string;
  projectSlug: string | null;
  data: unknown;
  input?: unknown;
  /** The connection's clock; reads and advisories agree on "now". */
  now?: () => number;
};
export type Finding = { code: AdvisoryCode; remedy: Hint; subject?: AdvisorySubject };
/** Read-only; it must not write (spec 010 FR-002). */
export type AdvisoryProvider = (
  database: DatabaseConnection['db'],
  request: AdvisoryRequest,
) => Finding[];
/** More findings of one code than this are reported once with a count (FR-004). */
export const AGGREGATE_FROM = 4;

function aggregate(findings: Finding[], aggregateFrom: number): Advisory[] {
  const result: Advisory[] = [];
  for (const code of advisoryCodes) {
    const same = findings
      .filter((finding) => finding.code === code)
      .sort((left, right) => (left.subject?.id ?? '').localeCompare(right.subject?.id ?? ''));
    const [first] = same;
    if (!first) continue;
    const message = advisoryCatalogue[code].message;
    if (same.length >= aggregateFrom) {
      result.push({ code, message, remedy: first.remedy, count: same.length });
      continue;
    }
    for (const finding of same)
      result.push({
        code,
        message,
        remedy: finding.remedy,
        ...(finding.subject === undefined ? {} : { subject: finding.subject }),
      });
  }
  return result;
}

/** Bounded, ordered advisories; a failing provider contributes nothing (FR-002). */
export function collectAdvisories(
  database: DatabaseConnection['db'],
  request: AdvisoryRequest,
  providers: readonly AdvisoryProvider[],
  aggregateFrom = AGGREGATE_FROM,
): { advisories?: Advisory[]; advisories_omitted?: number } {
  const findings = providers.flatMap((provider) => {
    try {
      return provider(database, request);
    } catch {
      return [];
    }
  });
  const all = aggregate(findings, aggregateFrom);
  if (all.length === 0) return {};
  return all.length > MAX_ADVISORIES
    ? { advisories: all.slice(0, MAX_ADVISORIES), advisories_omitted: all.length - MAX_ADVISORIES }
    : { advisories: all };
}
