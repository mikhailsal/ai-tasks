import type { TaskResource } from '../../../src/schema/tasks.js';
import { AppLink } from '../app/router.js';
import type { ViewGroup } from '../data/task-groups.js';
import { categoryLabels, modelLabel, priorityLabel, viewTime } from '../data/view-format.js';
import { CopyTextButton } from './CopyTextButton.js';

export function ProjectHeading({ group }: { group: ViewGroup }) {
  return (
    <>
      <h2>
        {group.project.emoji} {group.project.name}
      </h2>
      <p>
        Проект: {group.project.slug} · Приоритет проекта: {group.project.priority}
      </p>
      <p>
        {modelLabel(group.priority_model)} · Настройки: {group.project.config_revision}
      </p>
      {group.project.archived_at !== null && <p>Проект в архиве</p>}
      <CopyTextButton text={group.project.emoji} label="Скопировать эмодзи проекта">
        {group.project.emoji} Скопировать
      </CopyTextButton>
    </>
  );
}
export function TaskCard({
  task,
  group,
  timezone,
  asOf,
}: {
  task: TaskResource;
  group: ViewGroup;
  timezone: string;
  asOf: string;
}) {
  const statuses = task.kind === 'ordinary' ? group.ordinary_statuses : group.recurring_statuses;
  const status = statuses.find((item) => item.id === task.status_id);
  const unfinished =
    task.kind === 'recurring' || !['completed', 'cancelled'].includes(task.category);
  const overdue =
    unfinished &&
    task.display_deadline !== null &&
    Date.parse(task.display_deadline) < Date.parse(asOf);
  return (
    <li className="panel stack">
      <AppLink href={`/projects/${task.project_slug}/tasks/${task.id}`}>
        {task.emoji} {task.title}
      </AppLink>
      <p>
        {task.kind === 'ordinary' ? 'Обычная задача' : 'Повторяемая задача'} · {status?.label} ·{' '}
        {categoryLabels[task.category]}
      </p>
      <p>Приоритет: {priorityLabel(task.priority, group.priority_model)}</p>
      {task.display_deadline === null ? (
        <p>{task.kind === 'ordinary' ? 'Срок не указан' : 'Открытых повторений нет'}</p>
      ) : (
        <p>
          {task.kind === 'ordinary' ? 'Срок задачи' : 'По открытому повторению'}:{' '}
          <time dateTime={task.display_deadline}>{viewTime(task.display_deadline, timezone)}</time>
        </p>
      )}
      {overdue && <p>Просрочено</p>}
      {task.archived_at !== null && <p>Задача в архиве</p>}
      <CopyTextButton text={task.emoji} label="Скопировать эмодзи задачи">
        {task.emoji} Скопировать
      </CopyTextButton>
    </li>
  );
}
