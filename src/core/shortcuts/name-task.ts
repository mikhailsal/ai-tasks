import { and, eq } from 'drizzle-orm';
import { tasks, taskEmojiReservations } from '../../schema/entities.js';
import { uuidSchema } from '../../schema/values.js';
import type { DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { normalizeEmoji } from '../tasks/emoji.js';
import { requireTask } from '../tasks/read.js';

const MAX_LISTED = 20;

function reservedIcons(transaction: DatabaseTransaction, projectSlug: string): string[] {
  return transaction
    .select({ emoji: tasks.emoji })
    .from(taskEmojiReservations)
    .innerJoin(tasks, eq(tasks.id, taskEmojiReservations.taskId))
    .where(eq(taskEmojiReservations.projectSlug, projectSlug))
    .orderBy(tasks.emoji)
    .limit(MAX_LISTED)
    .all()
    .map((row) => row.emoji);
}

/**
 * A task named by its identifier or, within one project, by its reserved icon (spec 009 R3).
 * The default icon is shared, so it never names a task.
 */
export function nameTask(transaction: DatabaseTransaction, projectSlug: string, name: string) {
  if (uuidSchema.safeParse(name).success) return requireTask(transaction, projectSlug, name);
  let key: string;
  try {
    key = normalizeEmoji(name).key;
  } catch {
    throw domainError('VALIDATION_ERROR', 'Name the task by its identifier or its icon', {
      field: 'task',
      allowed: reservedIcons(transaction, projectSlug),
    });
  }
  if (key === '⚪')
    throw domainError(
      'VALIDATION_ERROR',
      'The default icon is shared by many tasks; name the task by its identifier',
      { field: 'task', allowed: reservedIcons(transaction, projectSlug) },
    );
  const reservation = transaction
    .select({ taskId: taskEmojiReservations.taskId })
    .from(taskEmojiReservations)
    .where(
      and(
        eq(taskEmojiReservations.projectSlug, projectSlug),
        eq(taskEmojiReservations.emojiKey, key),
      ),
    )
    .get();
  if (!reservation)
    throw domainError('TASK_NOT_FOUND', `No task in ${projectSlug} has the icon ${name}`, {
      field: 'task',
      allowed: reservedIcons(transaction, projectSlug),
    });
  return requireTask(transaction, projectSlug, reservation.taskId);
}
