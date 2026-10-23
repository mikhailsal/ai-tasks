import { useState } from 'react';
import type { MetaData } from '../../../src/schema/meta.js';
import { useMutationAvailability } from '../app/MutationBoundary.js';
import { AppLink } from '../app/router.js';
import { AddTaskButton } from '../components/AddTaskButton.js';
import { Button } from '../components/Button.js';
import { TaskCard } from '../components/TaskCard.js';
import { useTaskGroups } from '../data/task-groups.js';
import { errorMessage } from '../data/resources.js';

function TaskListState({
  pending,
  error,
  empty,
  restart,
}: {
  pending: boolean;
  error: unknown;
  empty: boolean;
  restart: () => Promise<void>;
}) {
  return (
    <>
      {pending && <p role="status">Загрузка задач…</p>}
      {error ? (
        <>
          <p role="alert">{errorMessage(error)}</p>
          <Button onClick={() => void restart()}>Обновить список</Button>
        </>
      ) : null}
      {empty && (
        <div className="panel empty-state">
          <h2>Место для новых планов</h2>
          <p>Задач пока нет. Выберите проект, чтобы добавить задачу.</p>
        </div>
      )}
    </>
  );
}

export function Tasks({ metadata }: { metadata: MetaData }) {
  const selected = new URLSearchParams(window.location.search).get('project_slug');
  const [includeTerminal, setIncludeTerminal] = useState(false);
  const parameters = new URLSearchParams({
    ...(selected === null ? { all_projects: 'true' } : { project_slug: selected }),
    include_terminal: String(includeTerminal),
  });
  const {
    query,
    groups,
    metadata: snapshot,
    restart,
  } = useTaskGroups('priorities', parameters.toString());
  const online = useMutationAvailability(metadata.database_epoch, selected ?? undefined);
  const items = groups.flatMap((group) => group.items.map((task) => ({ task, group })));
  const project = groups.find((group) => group.project.slug === selected)?.project;
  return (
    <section className="home-screen">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Ваш рабочий день</p>
          <h1>Задачи</h1>
        </div>
        <AddTaskButton {...(selected ? { projectSlug: selected } : {})} disabled={!online} />
      </div>
      <div className="list-toolbar">
        <AppLink href="/projects">
          {selected === null ? 'Все проекты' : (project?.name ?? 'Выбрать проект')}{' '}
          <span aria-hidden="true">⌄</span>
        </AppLink>
        <details className="list-options">
          <summary>Фильтры</summary>
          <div className="stack">
            <Button
              aria-pressed={includeTerminal}
              onClick={() => setIncludeTerminal(!includeTerminal)}
            >
              {includeTerminal
                ? 'Скрыть завершённые и отменённые'
                : 'Показать завершённые и отменённые'}
            </Button>
            {selected !== null && <AppLink href="/?all_projects=true">Все проекты</AppLink>}
          </div>
        </details>
      </div>
      {includeTerminal && <p className="subtle">Включая завершённые и отменённые</p>}
      <TaskListState
        pending={query.isPending}
        error={query.error}
        empty={query.isSuccess && items.length === 0}
        restart={restart}
      />
      <ul className="task-list">
        {snapshot &&
          items.map(({ task, group }) => (
            <TaskCard
              key={task.id}
              task={task}
              group={group}
              timezone={snapshot.timezone}
              asOf={snapshot.as_of}
              compact
            />
          ))}
      </ul>
      {query.hasNextPage && (
        <Button disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          Загрузить ещё задачи
        </Button>
      )}
    </section>
  );
}
