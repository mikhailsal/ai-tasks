import { eq } from 'drizzle-orm';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import { cancelOccurrencesSchema } from '../../schema/recurrence-input.js';
import { occurrences } from '../../schema/recurrence.js';
import { executeMutation } from '../database/mutate.js';
import type { CoreContext } from '../database/types.js';
import { collectBlockers, describeBlockers, occurrenceReason } from '../diagnostics/blockers.js';
import { domainError } from '../errors.js';
import { parseInput } from '../validation.js';
import {
  finishOccurrenceCommand,
  occurrenceCommandContext,
  selectOccurrences,
} from './outcomes.js';
import { occurrenceEvent } from './snapshots.js';

export function cancelOccurrences(
  context: CoreContext,
  projectSlug: string,
  taskId: string,
  input: MutationEnvelope,
) {
  return executeMutation({
    context,
    projectSlug,
    operation: 'occurrence.cancel',
    input,
    guards: { entity: { type: 'task', id: taskId } },
    handler(transaction, now) {
      const command = occurrenceCommandContext(transaction, projectSlug, taskId);
      const payload = parseInput(cancelOccurrencesSchema, input.payload);
      if (command.status.category !== 'paused') {
        const blockers = collectBlockers([], { now, extra: ['parent_not_paused'] });
        throw domainError('VALIDATION_ERROR', 'Pause the recurring parent before cancelling work', {
          blockers,
        });
      }
      const selected = selectOccurrences(transaction, {
        task: command.task,
        selected: payload.occurrences,
      });
      const refused = selected.filter((row) => occurrenceReason(row, now) !== 'future_pending');
      const first = refused[0];
      if (first) {
        const blockers = collectBlockers(refused, { now });
        const owedOnly = blockers.length === 1 && blockers[0]?.reason === 'owed';
        throw domainError(
          'VALIDATION_ERROR',
          owedOnly
            ? 'Owed occurrences cannot be cancelled. Complete them instead'
            : `${String(refused.length)} of ${String(selected.length)} occurrences cannot be cancelled: ${describeBlockers(blockers)}`,
          { entity_id: first.id, blockers },
        );
      }
      const cancelled = selected.map((before) => {
        const after = transaction
          .update(occurrences)
          .set({
            state: 'cancelled',
            revision: before.revision + 1,
            cancelledAt: now,
            cancelReason: payload.reason,
          })
          .where(eq(occurrences.id, before.id))
          .returning()
          .get();
        if (!after)
          throw domainError('INTERNAL_ERROR', 'Occurrence cancellation returned no result');
        return { row: after, event: occurrenceEvent(before, after, 'occurrence.cancel') };
      });
      return finishOccurrenceCommand(transaction, {
        context: command,
        rows: cancelled.map((result) => result.row),
        events: cancelled.map((result) => result.event),
        now,
        action: 'occurrence.cancel',
      });
    },
  });
}
