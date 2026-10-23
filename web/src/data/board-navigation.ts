import type { TaskResource } from '../../../src/schema/tasks.js';
import { navigate } from '../app/router.js';
import { boardHref } from './board-links.js';
export function boardNavigation(slug: string, kind: TaskResource['kind'], search: string) {
  const params = new URLSearchParams(search);
  function updateSearch(next: string) {
    navigate(boardHref(slug, kind, next));
  }
  function searchQuery(value: string) {
    params.set('q', value);
    params.set('search', 'true');
    updateSearch(params.toString());
  }
  function cancelSearch() {
    params.delete('q');
    params.delete('search');
    updateSearch(params.toString());
  }
  function reset() {
    for (const key of ['priority', 'deadline_preset', 'deadline_day', 'status_id'])
      params.delete(key);
    updateSearch(params.toString());
  }
  return { params, updateSearch, searchQuery, cancelSearch, reset };
}
