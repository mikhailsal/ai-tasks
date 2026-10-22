import { CopyTextButton } from '../components/CopyTextButton.js';
import { Button } from '../components/Button.js';
import { TaskControls } from './TaskControls.js';
import { Dependencies } from './Dependencies.js';
import type { TaskPage } from './task-model.js';
import type { TaskAction } from './use-task-commands.js';
import { AppLink } from '../app/router.js';

export function TaskSavedDetails({
  page,
  disabled,
  archived,
  onEdit,
  onAction,
}: {
  page: TaskPage;
  disabled: boolean;
  archived: boolean;
  onEdit: () => void;
  onAction: (action: TaskAction) => void;
}) {
  const task = page.task;
  if (!task) return null;
  return (
    <>
      {' '}
      <p>
        {task.emoji} ·{' '}
        {(task.kind === 'recurring'
          ? page.configuration.recurring_workflow
          : page.configuration.ordinary_workflow
        ).statuses.find((status) => status.id === task.status_id)?.label ?? task.status_id}
      </p>
      <Button disabled={disabled || archived} onClick={onEdit}>
        Редактировать
      </Button>
      <CopyTextButton
        text={task.emoji}
        label="Скопировать эмодзи"
        success="Эмодзи скопирован"
        failure="Не удалось скопировать эмодзи. Его можно выделить как текст."
      />
      {task.deadline && (
        <p>
          Срок:{' '}
          <time dateTime={task.deadline}>
            {new Intl.DateTimeFormat('ru-RU', {
              dateStyle: 'long',
              timeStyle: 'medium',
              timeZone: page.timezone,
            }).format(new Date(task.deadline))}
          </time>{' '}
          ({page.timezone})
        </p>
      )}
      <section
        aria-label="Описание задачи"
        className="markdown"
        dangerouslySetInnerHTML={{ __html: task.rendered_html }}
      />
      <details>
        <summary>Исходник Markdown</summary>
        <pre>{task.description}</pre>
      </details>
      {task.blocked && (
        <p role="alert">
          Сначала завершите связанные задачи. Доступные переходы учитывают зависимости.
        </p>
      )}
      {task.kind === 'ordinary' && (
        <Dependencies page={page} disabled={disabled || archived} onAction={onAction} />
      )}
      <TaskControls page={page} disabled={disabled} onAction={onAction} />
      <AppLink
        href={`/audit?project_slug=${encodeURIComponent(task.project_slug)}&entity_id=${encodeURIComponent(task.id)}`}
      >
        История изменений
      </AppLink>
    </>
  );
}
