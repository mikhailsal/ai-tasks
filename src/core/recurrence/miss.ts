import { and, eq } from 'drizzle-orm';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import { missOccurrencesSchema } from '../../schema/recurrence-input.js';
import { occurrences } from '../../schema/recurrence.js';
import type { AuditEvent } from '../audit/append.js';
import { executeMutation } from '../database/mutate.js';
import type { CoreContext, DatabaseTransaction } from '../database/types.js';
import {
  describeBlockers,
  describeSteps,
  groupBlockers,
  type BlockerReason,
} from '../diagnostics/blockers.js';
import { domainError } from '../errors.js';
import { parseInput } from '../validation.js';
import { expireOccurrence } from './expire.js';
import {
  finishOccurrenceCommand,
  occurrenceCommandContext,
  selectOccurrences,
} from './outcomes.js';
import { occurrenceEvent, type OccurrenceRow } from './snapshots.js';

type Plan = { row: OccurrenceRow; expired: AuditEvent[] };

/**
 * Why a selected row cannot be recorded as missed, after expiry ran (spec 007 R2).
 * A row that expiry just turned into a reasonless miss is accepted as it is.
 */
function refusal(plan: Plan, reason: string | undefined): BlockerReason | undefined {
  const { row } = plan;
  if (row.state === 'completed' || row.state === 'completed_late') return 'already_completed';
  if (row.state === 'cancelled') return 'cancelled';
  if (row.state === 'debt') return reason === undefined ? 'reason_required' : undefined;
  if (row.state === 'pending')
    return reason === undefined && row.missPolicy === 'carry_forward'
      ? 'reason_required'
      : undefined;
  if (row.missReason !== null) return 'reason_exists';
  return reason === undefined && plan.expired.length === 0 ? 'reason_required' : undefined;
}

function recordMiss(
  transaction: DatabaseTransaction,
  options: { plan: Plan; reason: string | undefined; now: number },
) {
  const before = options.plan.row;
  if (before.state === 'missed' && options.reason === undefined)
    return { row: before, events: options.plan.expired };
  const after = transaction
    .update(occurrences)
    .set({
      state: 'missed',
      missedAt: before.missedAt ?? options.now,
      ...(options.reason === undefined
        ? {}
        : { missReason: options.reason, missReasonRecordedAt: options.now }),
      revision: before.revision + 1,
    })
    .where(and(eq(occurrences.id, before.id), eq(occurrences.revision, before.revision)))
    .returning()
    .get();
  if (!after) throw domainError('INTERNAL_ERROR', 'Recording a miss returned no result');
  return {
    row: after,
    events: [...options.plan.expired, occurrenceEvent(before, after, 'occurrence.miss')],
  };
}

function refuse(plans: readonly Plan[], reason: string | undefined) {
  const refused = plans.flatMap((plan) => {
    const blocker = refusal(plan, reason);
    return blocker === undefined
      ? []
      : [{ id: plan.row.id, reason: blocker, state: plan.row.state }];
  });
  const first = refused[0];
  if (!first) return;
  const blockers = groupBlockers(refused);
  const lead =
    refused.length === 1
      ? `The occurrence is ${first.state}: ${describeBlockers(blockers)}`
      : `${String(refused.length)} of ${String(plans.length)} occurrences cannot be recorded as missed: ${describeBlockers(blockers)}`;
  throw domainError('VALIDATION_ERROR', `${lead}. ${describeSteps(blockers)}`, {
    entity_id: first.id,
    state: first.state,
    blockers,
  });
}

/** Records a miss now, adds a reason to a reasonless miss, or closes owed work (spec 007). */
export function missOccurrences(
  context: CoreContext,
  projectSlug: string,
  taskId: string,
  input: MutationEnvelope,
) {
  return executeMutation({
    context,
    projectSlug,
    operation: 'occurrence.miss',
    input,
    guards: { entity: { type: 'task', id: taskId } },
    handler(transaction, now) {
      const command = occurrenceCommandContext(transaction, projectSlug, taskId);
      const payload = parseInput(missOccurrencesSchema, input.payload);
      const selected = selectOccurrences(transaction, {
        task: command.task,
        selected: payload.occurrences,
      });
      const plans = selected.map((row) => {
        const expiry = expireOccurrence(transaction, { row, now });
        return { row: expiry.row, expired: expiry.events };
      });
      refuse(plans, payload.reason);
      const results = plans.map((plan) =>
        recordMiss(transaction, { plan, reason: payload.reason, now }),
      );
      return finishOccurrenceCommand(transaction, {
        context: command,
        rows: results.map((result) => result.row),
        events: results.flatMap((result) => result.events),
        now,
        action: 'occurrence.miss',
      });
    },
  });
}
