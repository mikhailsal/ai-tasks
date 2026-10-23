import type { PointerEvent } from 'react';
import type { PriorityModel } from '../../../src/schema/configuration.js';
import type { TaskResource } from '../../../src/schema/tasks.js';
import { AppLink } from '../app/router.js';
import { boardFilterHref, boardTaskHref, localDeadlineDay } from '../data/board-links.js';
import { priorityLabel } from '../data/view-format.js';
import { Button } from '../components/Button.js';

export function BoardTaskCard({
  task,
  model,
  timezone,
  search,
  status,
  movable,
  onMove,
  onDrag,
}: {
  task: TaskResource;
  model: PriorityModel;
  timezone: string;
  search: string;
  status?: string;
  movable: boolean;
  onMove(task: TaskResource): void;
  onDrag(event: PointerEvent<HTMLButtonElement>, task: TaskResource): void;
}) {
  const date = task.display_deadline;
  const day = date ? localDeadlineDay(date, timezone) : '';
  return (
    <li className="board-task" data-task-id={task.id}>
      <div className="board-task-heading">
        <AppLink href={boardTaskHref(task)} className="board-task-title">
          <span aria-hidden="true">{task.emoji}</span>
          <span>{task.title}</span>
        </AppLink>
        <Button
          className="board-drag-handle"
          variant="ghost"
          aria-label={`Переместить: ${task.title}`}
          disabled={!movable || task.archived_at !== null}
          onClick={() => onMove(task)}
          onPointerDown={(event) => onDrag(event, task)}
        >
          ⠿
        </Button>
      </div>
      {status && (
        <AppLink
          className="board-stage-tag"
          href={boardFilterHref(task, { statusId: task.status_id }, search)}
        >
          {status}
        </AppLink>
      )}
      <div className="board-task-tags">
        {date && (
          <AppLink
            className="board-tag board-date"
            href={boardFilterHref(task, { deadlineDay: day }, search)}
            label={`Срок: ${day}`}
          >
            <time dateTime={date}>
              {new Intl.DateTimeFormat('ru-RU', {
                timeZone: timezone,
                day: 'numeric',
                month: 'short',
              }).format(new Date(date))}
            </time>
          </AppLink>
        )}
        {task.priority !== null && (
          <AppLink
            className={`board-tag board-priority priority-${task.priority.model === 'classic' ? task.priority.level : 'custom'}`}
            href={boardFilterHref(task, { priority: task.priority }, search)}
          >
            {priorityLabel(task.priority, model)}
          </AppLink>
        )}
        {task.blocked === true && (
          <span
            className="board-tag board-blocked"
            title="Есть незавершённые предварительные задачи. Подробнее в карточке задачи."
          >
            Заблокирована
          </span>
        )}
        {task.archived_at !== null && <span className="board-tag">В архиве</span>}
      </div>
    </li>
  );
}
