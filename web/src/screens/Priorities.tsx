import { GroupedTasks } from './GroupedTasks.js';
export function Priorities({ search }: { search: string }) {
  return <GroupedTasks view="priorities" search={search} />;
}
