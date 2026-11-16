import { eq } from 'drizzle-orm';
import { boardMoveSchema } from '../../schema/board.js';
import { boardOrder } from '../../schema/board-storage.js';
import { tasks } from '../../schema/entities.js';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import { jsonValueSchema } from '../../schema/values.js';
import { executeMutation } from '../database/mutate.js';
import type { CoreContext, DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { readProjectConfiguration, requireProject } from '../projects/read.js';
import { parseInput } from '../validation.js';
import { bumpColumn, columnRevision, positionTask } from './board-order.js';
import { assertProjectActive, requireTask } from './read.js';
import { assertRecurrenceSettings } from './recurrence-write.js';
import { applyTaskTransition } from './transitions.js';
import { taskMutationResult } from './write.js';
function prepareMove(
  transaction: DatabaseTransaction,
  options: { projectSlug: string; taskId: string; input: MutationEnvelope },
) {
  const { projectSlug, taskId, input } = options;
  const project = requireProject(transaction, projectSlug);
  assertProjectActive(project);
  const before = requireTask(transaction, projectSlug, taskId);
  if (before.archivedAt !== null)
    throw domainError('VALIDATION_ERROR', 'Archived tasks are read-only');
  const data = parseInput(boardMoveSchema, input.payload);
  const config = readProjectConfiguration(transaction, project);
  if (before.kind === 'recurring') assertRecurrenceSettings(transaction, input);
  const sourceRevision = columnRevision(transaction, before);
  const destinationRevision = columnRevision(transaction, {
    ...before,
    statusId: data.to_status_id,
  });
  if (
    sourceRevision !== data.expected_source_order_revision ||
    destinationRevision !== data.expected_destination_order_revision
  )
    throw domainError(
      'REVISION_CONFLICT',
      'The board order has changed; refresh both columns before retrying',
      {
        current_source_order_revision: sourceRevision,
        current_destination_order_revision: destinationRevision,
      },
    );
  const oldPosition = transaction
    .select()
    .from(boardOrder)
    .where(eq(boardOrder.taskId, taskId))
    .get();
  return { project, before, data, config, oldPosition };
}
/** Status, both orders, lifecycle effects, audit and receipt commit in one transaction. */
export function moveBoardTask(
  context: CoreContext,
  projectSlug: string,
  taskId: string,
  input: MutationEnvelope,
) {
  return executeMutation({
    context,
    projectSlug,
    operation: 'task.position',
    input,
    guards: { entity: { type: 'task', id: taskId } },
    handler(transaction, now) {
      const { project, before, data, config, oldPosition } = prepareMove(transaction, {
        projectSlug,
        taskId,
        input,
      });
      const {
        before_task_id,
        expected_source_order_revision,
        expected_destination_order_revision,
        ...transition
      } = data;
      // Destructure concurrency fields so the existing strict transition contract remains authoritative.
      void expected_source_order_revision;
      void expected_destination_order_revision;
      const sameColumn = before.statusId === data.to_status_id;
      if (
        sameColumn &&
        (data.confirmation !== undefined ||
          data.replacement_emoji !== undefined ||
          data.emoji_collision !== undefined)
      )
        throw domainError(
          'VALIDATION_ERROR',
          'An order-only change does not accept transition controls',
        );
      const result = sameColumn
        ? (() => {
            const after = transaction
              .update(tasks)
              .set({ revision: before.revision + 1, updatedAt: now })
              .where(eq(tasks.id, taskId))
              .returning()
              .get();
            if (!after) throw domainError('INTERNAL_ERROR', 'Board task update returned no result');
            bumpColumn(transaction, before);
            return taskMutationResult(transaction, {
              before,
              after,
              project,
              config,
              action: 'task.position',
            });
          })()
        : applyTaskTransition(transaction, {
            projectSlug,
            taskId,
            now,
            input: { ...input, payload: jsonValueSchema.parse(transition) },
          });
      const after = requireTask(transaction, projectSlug, taskId);
      const position = positionTask(transaction, { task: after, beforeTaskId: before_task_id });
      const change = {
        field: 'board_position',
        before: oldPosition
          ? { status_id: oldPosition.statusId, position: oldPosition.position }
          : null,
        after: position,
      };
      return {
        ...result,
        events: result.events.map((event) =>
          event.entity_type === 'task' && event.entity_id === taskId
            ? {
                ...event,
                action: 'task.position',
                changes: [
                  ...event.changes.filter((entry) => entry.field !== 'board_position'),
                  change,
                ],
              }
            : event,
        ),
      };
    },
  });
}
