import { ReadFilters } from '../components/ReadFilters.js';
import { Button } from '../components/Button.js';
import { ProjectHeading, TaskCard } from '../components/TaskCard.js';
import { useTaskGroups, type ViewGroup } from '../data/task-groups.js';
import { agendaLabels, viewTime } from '../data/view-format.js';
import { errorMessage } from '../data/resources.js';

function ProjectItems({
  group,
  view,
  timezone,
  asOf,
}: {
  group: ViewGroup;
  view: 'agenda' | 'priorities';
  timezone: string;
  asOf: string;
}) {
  if (view === 'priorities')
    return (
      <ul className="task-list">
        {group.items.map((task) => (
          <TaskCard key={task.id} task={task} group={group} timezone={timezone} asOf={asOf} />
        ))}
      </ul>
    );
  return Object.entries(agendaLabels).map(([bucket, label]) => {
    const items = group.items.filter(
      (task) => 'agenda_bucket' in task && task.agenda_bucket === bucket,
    );
    return (
      <section key={bucket} aria-label={label}>
        <h3>{label}</h3>
        {items.length === 0 && <p>В этом разделе задач нет.</p>}
        <ul className="task-list">
          {items.map((task) => (
            <TaskCard key={task.id} task={task} group={group} timezone={timezone} asOf={asOf} />
          ))}
        </ul>
      </section>
    );
  });
}
export function GroupedTasks({ view, search }: { view: 'agenda' | 'priorities'; search: string }) {
  const { query, groups, metadata, lastRefresh, restart } = useTaskGroups(view, search);
  return (
    <section>
      <h1>{view === 'agenda' ? 'План' : 'Приоритеты'}</h1>
      <ReadFilters search={search} path={`/${view}`} />
      {metadata && (
        <>
          <p>
            Состояние на:{' '}
            <time dateTime={metadata.as_of}>{viewTime(metadata.as_of, metadata.timezone)}</time>
          </p>
          <p>Часовой пояс: {metadata.timezone}</p>
          {lastRefresh && (
            <p>
              Последнее обновление:{' '}
              <time dateTime={lastRefresh}>{viewTime(lastRefresh, metadata.timezone)}</time>
            </p>
          )}
        </>
      )}
      {query.isPending && <p role="status">Загрузка задач…</p>}
      {query.error && <p role="alert">{errorMessage(query.error)}</p>}
      <Button disabled={query.isFetching} onClick={() => void restart()}>
        Обновить с первой страницы
      </Button>
      {query.isSuccess && groups.length === 0 && <p>Задач пока нет.</p>}
      {metadata &&
        groups.map((group) => (
          <section
            key={group.project.slug}
            aria-label={`Проект ${group.project.slug}`}
            className="stack"
          >
            <ProjectHeading group={group} />
            <ProjectItems
              group={group}
              view={view}
              timezone={metadata.timezone}
              asOf={metadata.as_of}
            />
          </section>
        ))}
      {query.hasNextPage && (
        <Button
          disabled={query.isFetchingNextPage || query.isRefetching}
          onClick={() => void query.fetchNextPage()}
        >
          Загрузить ещё задачи
        </Button>
      )}
    </section>
  );
}
