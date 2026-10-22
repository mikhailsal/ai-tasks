import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod/mini';
import {
  agendaPageEnvelopeSchema,
  prioritiesPageEnvelopeSchema,
} from '../../../src/schema/read-views.js';
import { getApi } from './api.js';
export type ViewGroup = z.output<typeof prioritiesPageEnvelopeSchema>['data']['groups'][number];
function mergeGroups(pages: ViewGroup[][]): ViewGroup[] {
  const groups = new Map<string, ViewGroup>();
  for (const page of pages) {
    for (const group of page) {
      const previous = groups.get(group.project.slug);
      if (previous) previous.items.push(...group.items);
      else groups.set(group.project.slug, { ...group, items: [...group.items] });
    }
  }
  return [...groups.values()];
}
function viewParameters(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('cursor');
  if (!params.has('project_slug') && !params.has('all_projects'))
    params.set('all_projects', 'true');
  return params.toString();
}
export function useTaskGroups(view: 'agenda' | 'priorities', search: string) {
  const client = useQueryClient();
  const parameters = viewParameters(search);
  const queryKey = ['task-view', view, parameters];
  const schema = view === 'agenda' ? agendaPageEnvelopeSchema : prioritiesPageEnvelopeSchema;
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams(parameters);
      if (pageParam) params.set('cursor', pageParam);
      return getApi(`/${view}?${params}`, schema, signal);
    },
    getNextPageParam: (page) => page.data.next_cursor ?? undefined,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  async function restart(): Promise<void> {
    client.setQueryData<typeof query.data>(queryKey, (current) =>
      current
        ? {
            ...current,
            pages: current.pages.slice(0, 1),
            pageParams: current.pageParams.slice(0, 1),
          }
        : current,
    );
    await query.refetch();
  }
  const pages = query.data?.pages ?? [];
  return {
    query,
    groups: mergeGroups(pages.map((page) => page.data.groups)),
    metadata: pages[0]?.meta,
    lastRefresh: pages.at(-1)?.meta.now,
    restart,
  };
}
