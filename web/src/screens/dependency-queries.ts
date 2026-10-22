import { useInfiniteQuery } from '@tanstack/react-query';
import { getApi } from '../data/api.js';
import { projectPageSchema, taskPageSchema } from '../data/resources.js';

export function useDependencyProjects(epoch: string) {
  return useInfiniteQuery({
    queryKey: ['dependency-projects', epoch],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => {
      const query = new URLSearchParams({
        all_projects: 'true',
        archive: 'include',
        limit: '200',
        ...(pageParam ? { cursor: pageParam } : {}),
      });
      return getApi(`/projects?${query.toString()}`, projectPageSchema, signal);
    },
    getNextPageParam: (page) => page.data.next_cursor ?? undefined,
  });
}
export function useDependencyCandidates(projectSlug: string, search: string, epoch: string) {
  return useInfiniteQuery({
    queryKey: ['dependency-candidates', epoch, projectSlug, search],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => {
      const query = new URLSearchParams({
        project_slug: projectSlug,
        q: search,
        kind: 'ordinary',
        archive: 'include',
        include_terminal: 'true',
        limit: '50',
        ...(pageParam ? { cursor: pageParam } : {}),
      });
      return getApi(`/tasks?${query.toString()}`, taskPageSchema, signal);
    },
    getNextPageParam: (page) => page.data.next_cursor ?? undefined,
  });
}
