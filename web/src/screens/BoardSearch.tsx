import { useEffect, useRef } from 'react';
import type { PriorityModel } from '../../../src/schema/configuration.js';
import type { TaskResource } from '../../../src/schema/tasks.js';
import { Button } from '../components/Button.js';
import { boardItems, useBoardRead } from '../data/board.js';
import { boardReading } from '../data/board-reading.js';
import { BoardTaskCard } from './BoardTaskCard.js';
import type { ColumnScope } from './BoardColumn.js';
import { BoardReadState } from './BoardReadState.js';
export function BoardSearch({
  scope,
  readingKey,
  model,
  timezone,
  statuses,
  onQuery,
  onCancel,
}: {
  scope: ColumnScope;
  readingKey: string;
  model: PriorityModel;
  timezone: string;
  statuses: { id: string; label: string }[];
  onQuery(value: string): void;
  onCancel(): void;
}) {
  const q = new URLSearchParams(scope.search).get('q') ?? '';
  const query = useBoardRead({ ...scope, enabled: q.trim() !== '' });
  const list = useRef<HTMLElement>(null);
  const reading = boardReading(readingKey, '');
  useEffect(() => {
    if (list.current) list.current.scrollTop = reading.searchScroll;
  }, [reading]);
  const items = q.trim() ? boardItems(query) : [];
  return (
    <>
      <div className="board-search-bar">
        <div className="board-search-field">
          <label className="visually-hidden" htmlFor="project-task-search">
            Поиск задач в проекте
          </label>
          <input
            id="project-task-search"
            type="search"
            autoFocus
            placeholder="Название или описание"
            value={q}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onCancel();
            }}
          />
          <Button variant="ghost" aria-label="Очистить поиск" onClick={() => onQuery('')}>
            ×
          </Button>
        </div>
        <Button variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
      </div>
      <section
        className="board-search-results"
        aria-label="Результаты поиска"
        ref={list}
        onScroll={(event) => {
          reading.searchScroll = event.currentTarget.scrollTop;
        }}
      >
        <p role="status" className="subtle">
          {q.trim()
            ? `Найдено: ${items.length}${query.hasNextPage ? '+' : ''} · все стадии проекта`
            : 'Поиск по названию и описанию во всех стадиях проекта.'}
        </p>
        <ul className="board-card-list">
          {items.map((task) => (
            <SearchCard
              key={task.id}
              task={task}
              model={model}
              timezone={timezone}
              search={scope.search}
              statuses={statuses}
            />
          ))}
        </ul>
        {q.trim() && <BoardReadState query={query} search />}
      </section>
    </>
  );
}
function SearchCard({
  task,
  model,
  timezone,
  search,
  statuses,
}: {
  task: TaskResource;
  model: PriorityModel;
  timezone: string;
  search: string;
  statuses: { id: string; label: string }[];
}) {
  const noop = () => {};
  const noDrag = () => {};
  return (
    <BoardTaskCard
      task={task}
      model={model}
      timezone={timezone}
      search={search}
      status={statuses.find((status) => status.id === task.status_id)?.label ?? task.status_id}
      movable={false}
      onMove={noop}
      onDrag={noDrag}
    />
  );
}
