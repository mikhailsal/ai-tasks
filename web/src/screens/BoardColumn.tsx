import { useEffect, useRef, type PointerEvent } from 'react';
import type { PriorityModel } from '../../../src/schema/configuration.js';
import type { TaskResource } from '../../../src/schema/tasks.js';
import { boardItems, completeColumn, useBoardRead, type BoardRead } from '../data/board.js';
import { boardReading } from '../data/board-reading.js';
import { BoardTaskCard } from './BoardTaskCard.js';
import { BoardReadState, BoardSnapshot } from './BoardReadState.js';

export type ColumnScope = { slug: string; search: string; epoch: string; revision: number };
export function BoardColumn({
  scope,
  status,
  enabled,
  model,
  timezone,
  readingKey,
  movable,
  register,
  onMove,
  onDrag,
}: {
  scope: ColumnScope;
  status: { id: string; label: string };
  enabled: boolean;
  model: PriorityModel;
  timezone: string;
  readingKey: string;
  movable: boolean;
  register(id: string, read: BoardRead): void;
  onMove(task: TaskResource): void;
  onDrag(event: PointerEvent<HTMLButtonElement>, task: TaskResource): void;
}) {
  const query = useBoardRead({ ...scope, statusId: status.id, enabled });
  const list = useRef<HTMLDivElement>(null);
  const reading = boardReading(readingKey, status.id);
  const items = boardItems(query);
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
        <span className="stage-dot" aria-hidden="true" />
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
        <BoardSnapshot query={query} />
      </div>
    </section>
  );
}
