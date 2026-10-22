import type { tasks } from '../../schema/entities.js';

/** This persisted fact follows the live row across restore, independently of audit branches. */
export function completionRecordedAt(
  task: Pick<typeof tasks.$inferSelect, 'kind' | 'completionRecordedAt'>,
  beforeCategory: string,
  afterCategory: string,
  now: number,
): number | null {
  if (task.kind !== 'ordinary' || afterCategory !== 'completed') return null;
  return beforeCategory === 'completed' ? task.completionRecordedAt : now;
}
