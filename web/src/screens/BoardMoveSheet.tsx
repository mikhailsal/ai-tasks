import { useEffect, useState } from 'react';
import type { TaskResource } from '../../../src/schema/tasks.js';
import { Button } from '../components/Button.js';
import { Modal } from '../components/Modal.js';
import { boardItems, completeColumn, useBoardRead } from '../data/board.js';
import type { ColumnScope } from './BoardColumn.js';
import type { BoardMove } from './use-board-move.js';
import { BoardReadState } from './BoardReadState.js';
export function BoardMoveSheet({
  task,
  scope,
  move,
  close,
  register,
}: {
  task: TaskResource | null;
  scope: ColumnScope;
  move: BoardMove;
  close(): void;
  register(id: string, read: ReturnType<typeof useBoardRead>): void;
}) {
  const [target, setTarget] = useState(task?.status_id ?? '');
  const [before, setBefore] = useState('');
  const query = useBoardRead({
    ...scope,
    statusId: target,
    enabled: task !== null && target !== '',
  });
  useEffect(() => {
    if (target) register(target, query);
  }, [target, query, register]);
  const items = boardItems(query).filter((item) => item.id !== task?.id);
  const allowed =
    target === task?.status_id ||
    move.workflow.transitions.some((edge) => edge.from === task?.status_id && edge.to === target);
  function submit() {
    if (task && allowed && completeColumn(query)) {
      move.propose({ task, to: target, before: before || null });
      close();
    }
  }
  return (
    <>
      <Modal
        open={task !== null}
        onCancel={close}
        label="Перемещение задачи"
        className="board-sheet"
      >
        <h2>Переместить задачу</h2>
        <p>
          {task?.emoji} {task?.title}
        </p>
        <label className="field">
          Стадия назначения
          <select
            value={target}
            onChange={(event) => {
              setTarget(event.target.value);
              setBefore('');
            }}
          >
            {move.workflow.statuses.map((status) => (
              <option
                key={status.id}
                value={status.id}
                disabled={
                  status.id !== task?.status_id &&
                  !move.workflow.transitions.some(
                    (edge) => edge.from === task?.status_id && edge.to === status.id,
                  )
                }
              >
                {status.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Позиция
          <select
            value={before}
            onChange={(event) => setBefore(event.target.value)}
            disabled={!completeColumn(query)}
          >
            <option value="">В конец колонки</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                Перед: {item.title}
              </option>
            ))}
          </select>
        </label>
        <BoardReadState query={query} />
        {!completeColumn(query) && (
          <p className="subtle">
            Для перемещения загрузите колонку целиком, чтобы выбрать известную позицию.
          </p>
        )}
        <div className="actions">
          <Button onClick={close}>Отмена</Button>
          <Button
            variant="primary"
            disabled={!allowed || !completeColumn(query) || move.operation.busy}
            onClick={submit}
          >
            Переместить
          </Button>
        </div>
      </Modal>
      <MoveConfirmation move={move} />
    </>
  );
}
function MoveConfirmation({ move }: { move: BoardMove }) {
  return (
    <Modal
      open={move.request !== null}
      onCancel={move.cancel}
      label="Подтвердите переход"
      className="board-sheet"
    >
      <h2>Подтвердите переход</h2>
      <p>{move.request?.task.title}</p>
      <p>
        {move.workflow.statuses.find((status) => status.id === move.request?.task.status_id)?.label}{' '}
        → {move.workflow.statuses.find((status) => status.id === move.request?.to)?.label}
      </p>
      <label className="field">
        Текст подтверждения
        <textarea
          value={move.confirmation}
          onChange={(event) => move.setConfirmation(event.target.value)}
        />
      </label>
      <div className="actions">
        <Button onClick={move.cancel}>Отмена</Button>
        <Button
          variant="primary"
          disabled={!move.confirmation.trim() || move.operation.busy}
          onClick={move.confirm}
        >
          Подтвердить
        </Button>
      </div>
    </Modal>
  );
}
