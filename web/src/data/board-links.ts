import type { PriorityValue } from '../../../src/schema/configuration.js';
import type { TaskResource } from '../../../src/schema/tasks.js';

type TaskScope = Pick<TaskResource, 'project_slug' | 'kind'>;
export function boardReadContext(search: string): string {
  const input = new URLSearchParams(search);
  const context = new URLSearchParams();
  for (const key of ['q', 'priority', 'deadline_preset', 'deadline_day', 'status_id']) {
    const value = input.get(key);
    if (value !== null) context.set(key, value);
  }
  return context.toString();
}
export function boardHref(projectSlug: string, kind: TaskResource['kind'], search = ''): string {
  const params = new URLSearchParams(search);
  params.set('kind', kind);
  return `/projects/${encodeURIComponent(projectSlug)}/board?${params}`;
}
export function boardReturnHref(projectSlug: string, kind: TaskResource['kind']): string {
  const raw = new URLSearchParams(window.location.search).get('return_to');
  try {
    if (raw) {
      const url = new URL(raw, window.location.origin);
      if (
        url.origin === window.location.origin &&
        url.pathname === `/projects/${encodeURIComponent(projectSlug)}/board` &&
        (url.searchParams.get('kind') ?? 'ordinary') === kind
      )
        return url.pathname + url.search;
    }
  } catch {
    /* Invalid external return addresses use the project board. */
  }
  return boardHref(projectSlug, kind);
}
export function boardFilterHref(
  task: TaskScope,
  filters: { priority?: PriorityValue; deadlineDay?: string; statusId?: string },
  search?: string,
): string {
  const params = new URLSearchParams(
    search ?? new URL(boardReturnHref(task.project_slug, task.kind), window.location.origin).search,
  );
  if (Object.hasOwn(filters, 'priority')) params.set('priority', JSON.stringify(filters.priority));
  if (filters.deadlineDay !== undefined) {
    params.delete('deadline_preset');
    params.set('deadline_day', filters.deadlineDay);
  }
  if (filters.statusId !== undefined) params.set('status_id', filters.statusId);
  return boardHref(task.project_slug, task.kind, params.toString());
}
export function localDeadlineDay(timestamp: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function boardTaskHref(task: TaskScope & Pick<TaskResource, 'id'>): string {
  const params = new URLSearchParams({
    return_to: window.location.pathname + window.location.search,
  });
  return `/projects/${encodeURIComponent(task.project_slug)}/tasks/${encodeURIComponent(task.id)}?${params}`;
}
