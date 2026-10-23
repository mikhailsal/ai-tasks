import { Button } from '../components/Button.js';
import type { BoardMove } from './use-board-move.js';
export function BoardMoveNotice({
  move,
  online,
  epoch,
}: {
  move: BoardMove;
  online: boolean;
  epoch: string;
}) {
  const pending = move.operation.pending;
  const previousEpoch = pending && pending.envelope.database_epoch !== epoch;
  return (
    <>
      {move.error && (
        <div className="board-error" role="alert">
          <p>{move.error} Проверьте текущие данные перед новым перемещением.</p>
          <Button
            variant="ghost"
            aria-label="Закрыть сообщение об ошибке"
            onClick={move.dismissError}
          >
            ×
          </Button>
        </div>
      )}
      {move.operation.storageError && <p role="alert">{move.operation.storageError}</p>}
      {pending && (
        <div className="board-retry">
          <p role="status">
            {previousEpoch
              ? 'База данных восстановлена. Прежнее перемещение не будет отправлено. Проверьте текущую доску, затем отмените прежнее намерение и выберите позицию заново.'
              : 'Результат перемещения не подтверждён. Повторите ту же операцию для проверки.'}
          </p>
          {previousEpoch ? (
            <Button disabled={!online || move.operation.busy} onClick={() => void move.discard()}>
              Отменить прежнее перемещение
            </Button>
          ) : (
            <Button disabled={!online || move.operation.busy} onClick={() => void move.retry()}>
              Проверить результат перемещения
            </Button>
          )}
        </div>
      )}
    </>
  );
}
