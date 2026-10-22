import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { TaskResource } from '../../../src/schema/tasks.js';
import { Button } from '../components/Button.js';
import { getApi } from '../data/api.js';
import { errorMessage, taskPageSchema } from '../data/resources.js';
import { AppLink } from '../app/router.js';

const categoryLabels: Readonly<Record<string, string>> = {
  not_started: 'Не начато',
  in_progress: 'В работе',
  review: 'На проверке',
  completed: 'Завершено',
  cancelled: 'Отменено',
  draft: 'Черновик',
  active: 'Активно',
  paused: 'На паузе',
  archived: 'В архиве',
};

function TaskCard({ task }: { task: TaskResource }) {
  return (
    <li className="panel">
      <AppLink href={`/projects/${task.project_slug}/tasks/${task.id}`}>
        {task.emoji} {task.title}
      </AppLink>
      <p>
        Проект: {task.project_slug} · {categoryLabels[task.category]}
      </p>
      {task.archived_at !== null && <p>Задача в архиве</p>}
    </li>
  );
}

/** US1 list entry; agenda/model grouping joins in its owning query story. */
export function Tasks() {
  const selected = new URLSearchParams(window.location.search).get('project_slug');
  const [includeTerminal, setIncludeTerminal] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ['tasks', selected, includeTerminal],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        ...(selected === null ? { all_projects: 'true' } : { project_slug: selected }),
        include_terminal: String(includeTerminal),
        ...(pageParam ? { cursor: pageParam } : {}),
      });
      return getApi(`/tasks?${params.toString()}`, taskPageSchema, signal);
    },
    getNextPageParam: (page) => page.data.next_cursor ?? undefined,
    retry: false,
  });
  const items = query.data?.pages.flatMap((page) => page.data.items) ?? [];
  return (
    <section>
      <h1>Задачи</h1>
      <p>{selected === null ? 'Все проекты' : `Проект: ${selected}`}</p>
      <div className="actions">
        <AppLink href="/projects">Выбрать проект</AppLink>
        {selected !== null && <AppLink href="/?all_projects=true">Все проекты</AppLink>}
      </div>
      <Button aria-pressed={includeTerminal} onClick={() => setIncludeTerminal(!includeTerminal)}>
        {includeTerminal ? 'Скрыть завершённые и отменённые' : 'Показать завершённые и отменённые'}
      </Button>
      {query.isPending && <p role="status">Загрузка задач…</p>}
      {query.error && (
        <>
          <p role="alert">{errorMessage(query.error)}</p>
          <Button onClick={() => void query.refetch()}>Обновить список</Button>
        </>
      )}
      {query.isSuccess && items.length === 0 && (
        <p>Задач пока нет. Выберите проект, чтобы добавить задачу.</p>
      )}
      <ul className="task-list">
        {items.map((task) => (
          <TaskCard key={task.id} task={task} />
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
