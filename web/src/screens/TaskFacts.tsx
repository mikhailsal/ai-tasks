import { AppLink } from '../app/router.js';
import { boardFilterHref, localDeadlineDay } from '../data/board-links.js';
import { priorityLabel, viewTime } from '../data/view-format.js';
import type { TaskPage } from './task-model.js';

export function TaskFacts({ page }: { page: TaskPage }) {
  const task = page.task;
  if (!task) return null;
  const deadline = task.display_deadline ?? task.deadline;
  const workflow =
    task.kind === 'recurring'
      ? page.configuration.recurring_workflow
      : page.configuration.ordinary_workflow;
  return (
    <nav className="task-facts" aria-label="Быстрые фильтры задачи">
      <AppLink className="badge" href={boardFilterHref(task, { statusId: task.status_id })}>
        {workflow.statuses.find((status) => status.id === task.status_id)?.label ?? task.status_id}
      </AppLink>
      <AppLink className="badge" href={boardFilterHref(task, { priority: task.priority })}>
        Приоритет: {priorityLabel(task.priority, page.configuration.priority_model)}
      </AppLink>
      {deadline && (
        <AppLink
          className="badge"
          href={boardFilterHref(task, {
            deadlineDay: localDeadlineDay(deadline, page.timezone),
          })}
        >
          <time dateTime={deadline} title={viewTime(deadline, page.timezone)}>
            Срок:{' '}
            {new Intl.DateTimeFormat('ru-RU', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              timeZone: page.timezone,
            }).format(new Date(deadline))}
          </time>
        </AppLink>
      )}
    </nav>
  );
}
