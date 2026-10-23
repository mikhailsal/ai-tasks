import { Button } from '../components/Button.js';
import { BoardColumn } from './BoardColumn.js';
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
    register,
    setMenuTask,
    onTrackScroll,
  } = board;
  return (
    <>
      {stages.length === 0 && (
        <p role="alert">Выбранная стадия больше недоступна. Сбросьте фильтр.</p>
      )}
      <nav className="board-stage-tabs" aria-label="Стадии проекта">
        {stages.map((status, index) => (
          <Button key={status.id} aria-pressed={index === active} onClick={() => go(index)}>
            {status.label}
          </Button>
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
            register={register}
            onMove={(task) => {
              if (drag.clickAllowed()) setMenuTask(task);
            }}
            onDrag={drag.start}
          />
        ))}
      </div>
      {stages.length > 0 && (
        <div className="board-position">
          <Button
            variant="ghost"
            aria-label="Предыдущая стадия"
            disabled={active === 0}
            onClick={() => go(active - 1)}
          >
            ‹
          </Button>
          <span>
            {active + 1} из {stages.length} стадий
          </span>
          <Button
            variant="ghost"
            aria-label="Следующая стадия"
            disabled={active === stages.length - 1}
            onClick={() => go(active + 1)}
          >
            ›
          </Button>
        </div>
      )}
    </>
  );
}
