import { navigate } from '../app/router.js';
import { BoardColumn } from './BoardColumn.js';
import { BoardStageTab } from './BoardStageTab.js';
import type { BoardSessionState, SessionProps } from './use-board-session.js';
export function BoardStageTrack({
  board,
  configuration,
  metadata,
}: {
  board: BoardSessionState;
  configuration: SessionProps['configuration'];
  metadata: SessionProps['metadata'];
}) {
  const {
    stages,
    active,
    go,
    track,
    drag,
    scope,
    readingKey,
    movable,
    online,
    register,
    setMenuTask,
    onTrackScroll,
  } = board;
  const createParams = new URLSearchParams({
    kind: new URLSearchParams(scope.search).get('kind') === 'recurring' ? 'recurring' : 'ordinary',
    return_to: window.location.pathname + window.location.search,
  });
  const createHref = `/projects/${encodeURIComponent(scope.slug)}/tasks/new?${createParams}`;
  return (
    <>
      {stages.length === 0 && (
        <p role="alert">Выбранная стадия больше недоступна. Сбросьте фильтр.</p>
      )}
      <nav className="board-stage-tabs" aria-label="Стадии проекта">
        {stages.map((status, index) => (
          <BoardStageTab
            key={status.id}
            scope={scope}
            status={status}
            active={index === active}
            onSelect={() => go(index)}
          />
        ))}
      </nav>
      <div
        className={`board-track${drag.active ? ' board-drag-active' : ''}`}
        ref={track}
        aria-label="Колонки задач"
        onScroll={onTrackScroll}
      >
        {stages.map((status, index) => (
          <BoardColumn
            key={status.id}
            scope={scope}
            status={status}
            enabled={Math.abs(index - active) <= 1}
            model={configuration.data.priority_model}
            timezone={metadata.timezone}
            readingKey={readingKey}
            movable={movable}
            canAdd={online}
            onAdd={() => navigate(createHref)}
            register={register}
            onMove={(task) => {
              if (drag.clickAllowed()) setMenuTask(task);
            }}
            onDrag={drag.start}
          />
        ))}
      </div>
    </>
  );
}
