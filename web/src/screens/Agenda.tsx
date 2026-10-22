import { GroupedTasks } from './GroupedTasks.js';
export function Agenda({ search }: { search: string }) {
  return <GroupedTasks view="agenda" search={search} />;
}
