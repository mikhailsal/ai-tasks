import { useInfiniteQuery } from '@tanstack/react-query';
import type { z } from 'zod/mini';
import { boardColumnEnvelopeSchema } from '../../../src/schema/board.js';
import { getApi } from './api.js';
import { taskPageSchema } from './resources.js';

export const boardPageSchema = boardColumnEnvelopeSchema;
export type BoardPage = z.output<typeof boardPageSchema>;
export function boardParameters(search: string, statusId?: string) {
  const original = new URLSearchParams(search);
  const params = new URLSearchParams({
    kind: original.get('kind') === 'recurring' ? 'recurring' : 'ordinary',
    archive: 'include',
    include_terminal: 'true',
    limit: '30',
  });
  for (const key of ['q', 'priority', 'deadline_preset', 'deadline_day']) {
    const value = original.get(key);
    if (value) params.set(key, value);
  }
  const status = statusId ?? original.get('status_id');
  if (status) params.set('status_id', status);
  return params;
}
export function useBoardRead(options: {
  slug: string;
  search: string;
  statusId?: string;
  epoch: string;
  revision: number;
  enabled: boolean;
}) {
  const params = boardParameters(options.search, options.statusId);
  const search = params.toString();
  const path =
    options.statusId === undefined
      ? `/tasks?project_slug=${encodeURIComponent(options.slug)}&${search}`
      : `/projects/${encodeURIComponent(options.slug)}/board?${search}`;
  return useInfiniteQuery({
    queryKey: [
      'project-board',
      options.slug,
      options.epoch,
      options.revision,
      options.statusId === undefined ? 'search' : 'column',
      search,
    ],
    initialPageParam: '',
    enabled: options.enabled,
    queryFn: ({ pageParam, signal }) =>
      getApi(
        `${path}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        options.statusId === undefined ? taskPageSchema : boardPageSchema,
        signal,
      ),
    getNextPageParam: (page) => page.data.next_cursor ?? undefined,
    staleTime: 0,
    retry: false,
  });
}
export type BoardRead = ReturnType<typeof useBoardRead>;
export function boardItems(query: BoardRead) {
  return query.data?.pages.flatMap((page) => page.data.items) ?? [];
}
export function columnRevision(query: BoardRead): number | undefined {
  const page = query.data?.pages[0];
  return page && 'order_revision' in page.data && typeof page.data.order_revision === 'number'
    ? page.data.order_revision
    : undefined;
}
export function completeColumn(query: BoardRead): boolean {
  return query.isSuccess && !query.error && !query.hasNextPage && !query.isFetching;
}
export function boardHasFilters(search: string): boolean {
  const params = new URLSearchParams(search);
  return ['q', 'priority', 'deadline_preset', 'deadline_day', 'status_id'].some((key) =>
    params.has(key),
  );
}
