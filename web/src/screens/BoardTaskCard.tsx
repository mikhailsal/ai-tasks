import type { PointerEvent } from 'react';
import type { PriorityModel } from '../../../src/schema/configuration.js';
import type { TaskResource } from '../../../src/schema/tasks.js';
import { AppLink } from '../app/router.js';
import { boardFilterHref, boardTaskHref } from '../data/board-links.js';
import { priorityLabel } from '../data/view-format.js';
import { Button } from '../components/Button.js';
import { BoardDeadline } from './BoardDeadline.js';

export function BoardTaskCard({
  task,
  model,
  timezone,
  asOf,
  search,
  status,
  movable,
  onMove,
  onDrag,
  showHandle = true,
  excerpt,
}: {
  task: TaskResource;
  model: PriorityModel;
  timezone: string;
  asOf: string | undefined;
  search: string;
  status?: string;
  movable: boolean;
  onMove(task: TaskResource): void;
  onDrag(event: PointerEvent<HTMLButtonElement>, task: TaskResource): void;
  showHandle?: boolean;
  excerpt?: string;
}) {
  return (
    <li className="board-task" data-task-id={task.id}>
      <div className="board-task-heading">
        <AppLink href={boardTaskHref(task)} className="board-task-title">
          <span aria-hidden="true">{task.emoji}</span>
          <span>{task.title}</span>
        </AppLink>
        {showHandle && (
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
        )}
      </div>
      {excerpt && <p className="board-search-excerpt">{excerpt}</p>}
      {status && (
        <AppLink
          className="board-stage-tag"
          href={boardFilterHref(task, { statusId: task.status_id }, search)}
        >
          {status}
        </AppLink>
      )}
      <div className="board-task-tags">
        <BoardDeadline task={task} timezone={timezone} search={search} asOf={asOf} />
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
