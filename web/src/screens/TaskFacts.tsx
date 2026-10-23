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
      <AppLink className="task-fact" href={boardFilterHref(task, { statusId: task.status_id })}>
        <span className="badge">
          {workflow.statuses.find((status) => status.id === task.status_id)?.label ??
            task.status_id}
        </span>
      </AppLink>
      <AppLink
        className="task-fact"
        label={`Фильтр по приоритету: ${priorityLabel(task.priority, page.configuration.priority_model)}`}
        href={boardFilterHref(task, { priority: task.priority })}
      >
        <span className="badge">
          {priorityLabel(task.priority, page.configuration.priority_model)}
        </span>
      </AppLink>
      {deadline && (
        <AppLink
          className="task-fact"
          href={boardFilterHref(task, {
            deadlineDay: localDeadlineDay(deadline, page.timezone),
          })}
        >
          <span className="badge">
            <time dateTime={deadline} title={viewTime(deadline, page.timezone)}>
              {new Intl.DateTimeFormat('ru-RU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                timeZone: page.timezone,
              }).format(new Date(deadline))}
            </time>
          </span>
        </AppLink>
      )}
    </nav>
  );
}
