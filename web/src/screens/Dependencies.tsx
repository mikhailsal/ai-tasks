import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod/mini';
import type { dependencyResourceSchema } from '../../../src/schema/tasks.js';
import { Button } from '../components/Button.js';
import { readProject, readTask, errorMessage } from '../data/resources.js';
import type { TaskPage } from './task-model.js';
import type { TaskAction } from './task-action-identity.js';
import { DependencyPicker } from './DependencyPicker.js';
function DependencyLink({
  link,
  epoch,
  disabled,
  onAction,
}: {
  link: z.output<typeof dependencyResourceSchema>;
  epoch: string;
  disabled: boolean;
  onAction(action: TaskAction): void;
}) {
  const task = useQuery({
    queryKey: ['dependency-task', epoch, link.prerequisite_project_slug, link.prerequisite_task_id],
    queryFn: ({ signal }) =>
      readTask(link.prerequisite_project_slug, link.prerequisite_task_id, signal),
    retry: false,
  });
  const project = useQuery({
    queryKey: ['dependency-project', epoch, link.prerequisite_project_slug],
    queryFn: ({ signal }) => readProject(link.prerequisite_project_slug, signal),
    retry: false,
  });
  return (
    <li>
      <a
        href={`/projects/${encodeURIComponent(link.prerequisite_project_slug)}/tasks/${link.prerequisite_task_id}`}
      >
        {task.data
          ? `${task.data.data.emoji} ${task.data.data.title}`
          : 'Открыть предварительную задачу'}
      </a>
      <p>
        Проект: {project.data?.data.name ?? link.prerequisite_project_slug}
        {task.data?.data.archived_at || project.data?.data.archived_at ? ' · В архиве' : ''}
      </p>
      <p>
        {link.satisfied
          ? 'Завершена — условие выполнено.'
          : 'Не завершена — блокирует переход в работу, проверку и завершение.'}
      </p>
      {task.isPending && <p role="status">Загрузка названия задачи…</p>}
      {task.error && (
        <>
          <p role="alert">{errorMessage(task.error)}</p>
          <Button onClick={() => void task.refetch()}>Повторить загрузку задачи</Button>
        </>
      )}
      {project.error && <p role="alert">{errorMessage(project.error)}</p>}
      <Button
        disabled={disabled}
        onClick={() =>
          onAction({
            suffix: 'dependencies/remove',
            payload: {
              prerequisite_task_id: link.prerequisite_task_id,
              prerequisite_project_slug: link.prerequisite_project_slug,
            },
          })
        }
      >
        Удалить зависимость
      </Button>
    </li>
  );
}
export function Dependencies({
  page,
  disabled,
  onAction,
}: {
  page: TaskPage;
  disabled: boolean;
  onAction(action: TaskAction): void;
}) {
  const [adding, setAdding] = useState(false);
  const task = page.task;
  if (!task) return null;
  const archived = task.archived_at !== null || page.project.archived_at !== null;
  const readonly = disabled || archived || task.kind !== 'ordinary';
  const additionDisabled = readonly || task.dependencies.length >= 100;
  return (
    <section role="region" aria-label="Зависимости" className="stack">
      <h2>Зависимости</h2>
      {archived && (
        <p>
          В архиве зависимости доступны только для чтения. Сначала восстановите задачу и проект.
        </p>
      )}
      {task.kind !== 'ordinary' && <p>Зависимости доступны только для обычных задач.</p>}
      {task.dependencies.length === 0 ? (
        <p>Предварительных задач пока нет.</p>
      ) : (
        <ul className="task-list">
          {task.dependencies.map((link) => (
            <DependencyLink
              key={link.prerequisite_task_id}
              link={link}
              epoch={page.epoch}
              disabled={readonly}
              onAction={onAction}
            />
          ))}
        </ul>
      )}
      {task.dependencies.length >= 100 && (
        <p>
          Добавлено 100 предварительных задач. Для новой зависимости сначала удалите одну из
          существующих.
        </p>
      )}
      <Button disabled={additionDisabled} onClick={() => setAdding(true)}>
        Добавить зависимость
      </Button>
      {adding && (
        <DependencyPicker
          page={page}
          disabled={additionDisabled}
          onAction={onAction}
          onClose={() => setAdding(false)}
        />
      )}
    </section>
  );
}
