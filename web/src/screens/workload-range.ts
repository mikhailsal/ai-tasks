import { statisticsInputSchema } from '../../../src/schema/read-views.js';
import { deadlineDraft, resolveLocalDeadline, type DeadlineDraft } from '../data/local-time.js';
export type WorkloadRangeDraft = { from: DeadlineDraft; to: DeadlineDraft; timezone: string };
export function statisticsPath(search: string) {
  const params = new URLSearchParams(search);
  const entries: [string, unknown][] = [];
  for (const [key, value] of params) {
    if (params.getAll(key).length !== 1) throw new Error('Фильтр указан несколько раз.');
    let decoded: unknown = value;
    if (['all_projects', 'include_terminal', 'priority'].includes(key)) {
      try {
        decoded = JSON.parse(value);
      } catch {
        throw new Error('Проверьте фильтры нагрузки.');
      }
    }
    entries.push([key, decoded]);
  }
  const input = Object.fromEntries(entries);
  if (!params.has('project_slug') && !params.has('all_projects')) input.all_projects = true;
  const parsed = statisticsInputSchema.safeParse(input);
  if (!parsed.success) throw new Error('Проверьте фильтры и границы периода.');
  if (!params.has('project_slug') && !params.has('all_projects'))
    params.set('all_projects', 'true');
  return `/stats?${params}`;
}
export function workloadRange(search: string, timezone: string): WorkloadRangeDraft {
  const query = new URLSearchParams(search);
  return {
    from: deadlineDraft(query.get('from'), timezone),
    to: deadlineDraft(query.get('to'), timezone),
    timezone,
  };
}
export function workloadRangeHref(search: string, draft: WorkloadRangeDraft) {
  const from = resolveLocalDeadline(draft.from, draft.timezone);
  const to = resolveLocalDeadline(draft.to, draft.timezone);
  if (from !== null && to !== null && Date.parse(from) > Date.parse(to))
    throw new Error('Начало периода позже конца. Исправьте границы.');
  const query = new URLSearchParams(search);
  for (const key of ['cursor', 'limit', 'from', 'to']) query.delete(key);
  if (from !== null) query.set('from', from);
  if (to !== null) query.set('to', to);
  if (!query.has('project_slug') && !query.has('all_projects')) query.set('all_projects', 'true');
  return `/workload?${query}`;
}
