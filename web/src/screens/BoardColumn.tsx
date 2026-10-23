import { useEffect, useRef, type PointerEvent } from 'react';
import type { PriorityModel, ProjectConfigInput } from '../../../src/schema/configuration.js';
import type { TaskResource } from '../../../src/schema/tasks.js';
import { boardItems, completeColumn, useBoardRead, type BoardRead } from '../data/board.js';
import { boardReading } from '../data/board-reading.js';
import { BoardTaskCard } from './BoardTaskCard.js';
import { BoardReadState, BoardSnapshot } from './BoardReadState.js';
import { Button } from '../components/Button.js';

export type ColumnScope = { slug: string; search: string; epoch: string; revision: number };
export type BoardStatus =
  | ProjectConfigInput['ordinary_workflow']['statuses'][number]
  | ProjectConfigInput['recurring_workflow']['statuses'][number];
export function BoardColumn({
  scope,
  status,
  enabled,
  model,
  timezone,
  readingKey,
  movable,
  canAdd,
  onAdd,
  register,
  onMove,
  onDrag,
}: {
  scope: ColumnScope;
  status: BoardStatus;
  enabled: boolean;
  model: PriorityModel;
  timezone: string;
  readingKey: string;
  movable: boolean;
  canAdd: boolean;
  onAdd(): void;
  register(id: string, read: BoardRead): void;
  onMove(task: TaskResource): void;
  onDrag(event: PointerEvent<HTMLButtonElement>, task: TaskResource): void;
}) {
  const query = useBoardRead({ ...scope, statusId: status.id, enabled });
  const list = useRef<HTMLDivElement>(null);
  const reading = boardReading(readingKey, status.id);
  const items = boardItems(query);
  const meta = query.data?.pages[0]?.meta;
  useEffect(() => {
    register(status.id, query);
  }, [register, status.id, query]);
  useEffect(() => {
    if (list.current) list.current.scrollTop = reading.positions.get(status.id) ?? 0;
  }, [reading, status.id]);
  const count = query.data
    ? `${items.length}${query.hasNextPage ? '+' : ''}`
    : query.isError
      ? '!'
      : '…';
  return (
    <section className="board-column" data-status-id={status.id} aria-label={status.label}>
      <div className="board-column-heading">
        <span className="stage-dot" data-color={status.color} aria-hidden="true" />
        <h2>{status.label}</h2>
        <span
          className="board-counter"
          aria-label={`${items.length} загружено${query.hasNextPage ? ', есть ещё' : ''}`}
        >
          {count}
        </span>
      </div>
      <div
        className="board-cards"
        ref={list}
        onScroll={(event) => reading.positions.set(status.id, event.currentTarget.scrollTop)}
      >
        <ul className="board-card-list">
          {items.map((task) => (
            <BoardTaskCard
              key={task.id}
              task={task}
              model={model}
              timezone={timezone}
              asOf={meta?.as_of ?? meta?.now}
              search={scope.search}
              movable={movable && completeColumn(query)}
              onMove={onMove}
              onDrag={onDrag}
            />
          ))}
        </ul>
        {enabled ? (
          <BoardReadState query={query} />
        ) : (
          !query.data && <p className="board-empty">Откройте стадию, чтобы загрузить задачи.</p>
        )}
        <Button
          className="board-add-card"
          variant="ghost"
          aria-label={`Добавить задачу: ${status.label}`}
          title="Новая задача появится в начальной стадии проекта"
          disabled={!canAdd}
          onClick={onAdd}
        >
          + Добавить
        </Button>
        <BoardSnapshot query={query} />
      </div>
    </section>
  );
}
