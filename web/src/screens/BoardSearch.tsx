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
  const meta = query.data?.pages[0]?.meta;
  return (
    <>
      <div className="board-search-bar">
        <div className="board-search-field">
          <label className="visually-hidden" htmlFor="project-task-search">
            Поиск задач в проекте
          </label>
          <svg
            aria-hidden="true"
            className="board-search-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
          <input
            id="project-task-search"
            type="search"
            autoFocus
            placeholder="Найти задачу"
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
              asOf={meta?.as_of ?? meta?.now}
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
  asOf,
  search,
  statuses,
}: {
  task: TaskResource;
  model: PriorityModel;
  timezone: string;
  asOf: string | undefined;
  search: string;
  statuses: { id: string; label: string }[];
}) {
  const noop = () => {};
  const noDrag = () => {};
  const term = new URLSearchParams(search).get('q')?.trim().toLocaleLowerCase() ?? '';
  const position = term ? task.description.toLocaleLowerCase().indexOf(term) : -1;
  const excerpt =
    position >= 0 && !task.title.toLocaleLowerCase().includes(term)
      ? task.description.slice(Math.max(0, position - 45), position + 120).replace(/\s+/gu, ' ')
      : undefined;
  return (
    <BoardTaskCard
      task={task}
      model={model}
      timezone={timezone}
      asOf={asOf}
      search={search}
      status={statuses.find((status) => status.id === task.status_id)?.label ?? task.status_id}
      movable={false}
      onMove={noop}
      onDrag={noDrag}
      showHandle={false}
      {...(excerpt ? { excerpt } : {})}
    />
  );
}
