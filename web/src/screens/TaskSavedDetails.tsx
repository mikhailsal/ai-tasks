import { CopyTextButton } from '../components/CopyTextButton.js';
import { TaskControls } from './TaskControls.js';
import { Dependencies } from './Dependencies.js';
import type { TaskPage } from './task-model.js';
import type { TaskAction } from './use-task-commands.js';
import { viewTime } from '../data/view-format.js';

export function TaskSavedDetails({
  page,
  disabled,
  archived,
  onAction,
}: {
  page: TaskPage;
  disabled: boolean;
  archived: boolean;
  onAction: (action: TaskAction) => void;
}) {
  const task = page.task;
  if (!task) return null;
  return (
    <section className="task-saved-details" aria-label="Сохранённая задача и действия">
      {task.blocked && (
        <p role="alert">
          Сначала завершите связанные задачи. Доступные переходы учитывают зависимости.
        </p>
      )}
      <TaskControls page={page} disabled={disabled} onAction={onAction} />
      <div className="action-row">
        <CopyTextButton
          text={task.emoji}
          label="Скопировать эмодзи"
          success="Эмодзи скопирован"
          failure="Не удалось скопировать эмодзи. Его можно выделить как текст."
        />
      </div>
      {task.deadline && (
        <details className="details-panel">
          <summary>Точный срок и часовой пояс</summary>
          <p>
            Срок: <time dateTime={task.deadline}>{viewTime(task.deadline, page.timezone)}</time> (
            {page.timezone})
          </p>
        </details>
      )}
      <details className="details-panel task-saved-description">
        <summary>Сохранённое описание</summary>
        <section
          aria-label="Описание задачи"
          className="markdown"
          dangerouslySetInnerHTML={{ __html: task.rendered_html }}
        />
        <details className="details-panel">
          <summary>Исходник Markdown</summary>
          <pre>{task.description}</pre>
        </details>
      </details>
      {task.kind === 'ordinary' && (
        <Dependencies page={page} disabled={disabled || archived} onAction={onAction} />
      )}
    </section>
  );
}
