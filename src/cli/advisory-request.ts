import type { Advisory } from '../schema/advisories.js';
import type { AdvisoryRequest } from '../core/advisories/collect.js';

/** CLI names that differ from the HTTP helper operation names. */
const renamed: Record<string, string> = {
  agenda: 'agenda.list',
  priorities: 'priorities.list',
  stats: 'stats.get',
};
let current: Omit<AdvisoryRequest, 'data'> | undefined;

/** One CLI process runs one command; its request is remembered for spec 010 advisories. */
export function rememberRequest(
  path: readonly string[],
  projectSlug: string | undefined,
  input: unknown,
): void {
  const joined = path.join('.');
  current = { operation: renamed[joined] ?? joined, projectSlug: projectSlug ?? null, input };
}
/** Taken once: a later command in the same process never sees this request. */
export function rememberedRequest() {
  const request = current;
  current = undefined;
  return request;
}
let found: { advisories?: Advisory[]; advisories_omitted?: number } = {};
/** Advisories computed while the database was open, added when the response is written. */
export function rememberAdvisories(value: typeof found): void {
  found = value;
}
/** Taken once, like the request. */
export function rememberedAdvisories() {
  const value = found;
  found = {};
  return value;
}
