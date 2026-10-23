import { and, eq, ne, sql } from 'drizzle-orm';
import { boardColumns, boardOrder } from '../../schema/board-storage.js';
import type { tasks } from '../../schema/entities.js';
import type { DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
type Column = Pick<typeof tasks.$inferSelect, 'projectSlug' | 'kind' | 'statusId'>;
export function columnPredicate(column: Column) {
  return and(
    eq(boardOrder.projectSlug, column.projectSlug),
    eq(boardOrder.kind, column.kind),
    eq(boardOrder.statusId, column.statusId),
  );
}
export function columnRevision(transaction: DatabaseTransaction, column: Column) {
  return (
    transaction
      .select()
      .from(boardColumns)
      .where(
        and(
          eq(boardColumns.projectSlug, column.projectSlug),
          eq(boardColumns.kind, column.kind),
          eq(boardColumns.statusId, column.statusId),
        ),
      )
      .get()?.revision ?? 1
  );
}
export function bumpColumn(transaction: DatabaseTransaction, column: Column) {
  transaction
    .insert(boardColumns)
    .values({ ...column, revision: 2 })
    .onConflictDoUpdate({
      target: [boardColumns.projectSlug, boardColumns.kind, boardColumns.statusId],
      set: { revision: sql`${boardColumns.revision} + 1` },
    })
    .run();
}
function appendPosition(transaction: DatabaseTransaction, column: Column) {
  return (
    transaction
      .select({ value: sql<number>`coalesce(max(${boardOrder.position}),0) + 1` })
      .from(boardOrder)
      .where(columnPredicate(column))
      .get()?.value ?? 1
  );
}
function preservesArchivePosition(
  before: typeof tasks.$inferSelect | null,
  after: typeof tasks.$inferSelect,
) {
  return (
    before !== null &&
    before.statusId === after.statusId &&
    before.archivedAt === null &&
    after.archivedAt !== null
  );
}
/** All normal task lifecycle writers append entries through their shared result builder. */
export function syncBoardMembership(
  transaction: DatabaseTransaction,
  options: {
    before: typeof tasks.$inferSelect | null;
    after: typeof tasks.$inferSelect;
  },
) {
  const { before, after } = options;
  const changed =
    before === null ||
    before.statusId !== after.statusId ||
    (before.archivedAt === null) !== (after.archivedAt === null);
  if (!changed) return;
  const previous = transaction
    .select()
    .from(boardOrder)
    .where(eq(boardOrder.taskId, after.id))
    .get();
  transaction.delete(boardOrder).where(eq(boardOrder.taskId, after.id)).run();
  if (before !== null) bumpColumn(transaction, before);
  const position =
    preservesArchivePosition(before, after) && previous
      ? previous.position
      : appendPosition(transaction, after);
  transaction
    .insert(boardOrder)
    .values({
      taskId: after.id,
      projectSlug: after.projectSlug,
      kind: after.kind,
      statusId: after.statusId,
      position,
    })
    .run();
  if (before === null || before.statusId !== after.statusId) bumpColumn(transaction, after);
  return {
    field: 'board_position',
    before: previous ? { status_id: previous.statusId, position: previous.position } : null,
    after: { status_id: after.statusId, position },
  };
}
/** Shift only the explicitly addressed destination column; hidden columns are never loaded. */
export function positionTask(
  transaction: DatabaseTransaction,
  options: { task: typeof tasks.$inferSelect; beforeTaskId: string | null },
) {
  const { task, beforeTaskId } = options;
  if (beforeTaskId === task.id)
    throw domainError('VALIDATION_ERROR', 'A task cannot be positioned before itself');
  const anchor =
    beforeTaskId === null
      ? undefined
      : transaction
          .select()
          .from(boardOrder)
          .where(and(eq(boardOrder.taskId, beforeTaskId), columnPredicate(task)))
          .get();
  if (beforeTaskId !== null && !anchor)
    throw domainError('VALIDATION_ERROR', 'The position anchor is not in the destination column');
  const position = anchor?.position ?? appendPosition(transaction, task);
  transaction
    .update(boardOrder)
    .set({ position: sql`${boardOrder.position} + 1` })
    .where(
      and(
        columnPredicate(task),
        ne(boardOrder.taskId, task.id),
        sql`${boardOrder.position} >= ${position}`,
      ),
    )
    .run();
  transaction.update(boardOrder).set({ position }).where(eq(boardOrder.taskId, task.id)).run();
  return { status_id: task.statusId, position };
}
