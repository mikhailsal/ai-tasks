import type { TaskResource } from '../../../src/schema/tasks.js';
import { boardFilterHref, boardReadContext, localDeadlineDay } from '../data/board-links.js';
import { AppLink } from '../app/router.js';
import type { ViewGroup } from '../data/task-groups.js';
import { categoryLabels, modelLabel, priorityLabel, viewTime } from '../data/view-format.js';
import { CopyTextButton } from './CopyTextButton.js';

export function ProjectHeading({ group }: { group: ViewGroup }) {
  return (
    <>
      <div className="page-heading">
        <h2>
          {group.project.emoji} {group.project.name}
        </h2>
        <span className="badge">Приоритет проекта: {group.project.priority}</span>
      </div>
      {group.project.archived_at !== null && <p className="badge badge-muted">Проект в архиве</p>}
      <details className="details-panel">
        <summary>Сведения о проекте</summary>
        <p>Проект: {group.project.slug}</p>
        <p>
          {modelLabel(group.priority_model)} · Настройки: {group.project.config_revision}
        </p>
      </details>
      <CopyTextButton text={group.project.emoji} label="Скопировать эмодзи проекта">
        {group.project.emoji} Скопировать
      </CopyTextButton>
    </>
  );
}

function TaskDeadline({
  task,
  timezone,
  search,
}: {
  task: TaskResource;
  timezone: string;
  search: string;
}) {
  if (task.display_deadline === null)
    return (
      <p className="task-deadline subtle">
        {task.kind === 'ordinary' ? 'Срок не указан' : 'Открытых повторений нет'}
      </p>
    );
  return (
    <p className="task-deadline">
      {task.kind === 'ordinary' ? 'Срок задачи' : 'По открытому повторению'}:{' '}
      <AppLink
        href={boardFilterHref(
          task,
          { deadlineDay: localDeadlineDay(task.display_deadline, timezone) },
          search,
        )}
      >
        <time
          dateTime={task.display_deadline}
          title={`${viewTime(task.display_deadline, timezone)} (${timezone})`}
        >
          {new Intl.DateTimeFormat('ru-RU', {
            timeZone: timezone,
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(task.display_deadline))}
        </time>
      </AppLink>
    </p>
  );
}

function TaskExtras({ task, timezone }: { task: TaskResource; timezone: string }) {
  return (
    <details className="details-panel">
      <summary>Подробнее о задаче</summary>
      <p>
        {task.kind === 'ordinary' ? 'Обычная задача' : 'Повторяемая задача'} ·{' '}
        {categoryLabels[task.category]}
      </p>
      {task.display_deadline !== null && (
        <p>
          Точный срок:{' '}
          <time dateTime={task.display_deadline}>
            {viewTime(task.display_deadline, timezone)} ({timezone})
          </time>
        </p>
      )}
      <CopyTextButton text={task.emoji} label="Скопировать эмодзи задачи">
        {task.emoji} Скопировать
      </CopyTextButton>
    </details>
  );
}

export function TaskCard({
  task,
  group,
  timezone,
  asOf,
  compact = false,
}: {
  task: TaskResource;
  group: ViewGroup;
  timezone: string;
  asOf: string;
  compact?: boolean;
}) {
  const search = boardReadContext(window.location.search);
  const statuses = task.kind === 'ordinary' ? group.ordinary_statuses : group.recurring_statuses;
  const status = statuses.find((item) => item.id === task.status_id);
  const unfinished =
    task.kind === 'recurring' || !['completed', 'cancelled'].includes(task.category);
  const overdue =
    unfinished &&
    task.display_deadline !== null &&
    Date.parse(task.display_deadline) < Date.parse(asOf);
  return (
    <li className="task-card">
      {compact && <p className="subtle">{group.project.name}</p>}
      <AppLink className="task-card-title" href={`/projects/${task.project_slug}/tasks/${task.id}`}>
        {task.emoji} {task.title}
      </AppLink>
      <p className="task-card-meta">
        <AppLink
          className="badge"
          href={boardFilterHref(task, { statusId: task.status_id }, search)}
        >
          {status?.label ?? categoryLabels[task.category]}
        </AppLink>
        <AppLink
          href={boardFilterHref(task, { priority: task.priority }, search)}
          className={`badge${task.priority === null ? ' badge-muted' : ''}`}
        >
          Приоритет: {priorityLabel(task.priority, group.priority_model)}
        </AppLink>
        {overdue && <span className="badge badge-danger">Просрочено</span>}
        {task.blocked === true && (
          <span className="badge board-blocked" title="Есть незавершённые предварительные задачи.">
            Заблокирована
          </span>
        )}
        {task.archived_at !== null && <span className="badge badge-muted">Задача в архиве</span>}
      </p>
      <TaskDeadline task={task} timezone={timezone} search={search} />
      {!compact && <TaskExtras task={task} timezone={timezone} />}
    </li>
  );
}
