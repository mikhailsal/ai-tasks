import { useEffect, useRef } from 'react';
import { Button } from '../components/Button.js';
import { boardItems, useBoardRead } from '../data/board.js';
import type { BoardStatus, ColumnScope } from './BoardColumn.js';

export function BoardStageTab({
  scope,
  status,
  active,
  onSelect,
}: {
  scope: ColumnScope;
  status: BoardStatus;
  active: boolean;
  onSelect(): void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const query = useBoardRead({ ...scope, statusId: status.id, enabled: false });
  const count = query.data ? `${boardItems(query).length}${query.hasNextPage ? '+' : ''}` : '…';
  useEffect(() => {
    if (active)
      button.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }, [active]);
  return (
    <Button ref={button} aria-label={status.label} aria-pressed={active} onClick={onSelect}>
      {status.label}
      <span className="board-stage-count" data-count={count} aria-hidden="true" />
    </Button>
  );
}
