import { blockerReasons } from '../../schema/diagnostics.js';
import { diagnosticBounds } from './bounds.js';
import { hint, type Hint } from './hints.js';

export { blockerReasons };
export type BlockerReason = (typeof blockerReasons)[number];

export type Blocker = {
  reason: BlockerReason;
  count: number;
  occurrence_ids: string[];
  omitted: number;
  step: Hint;
};

const steps: Record<BlockerReason, Hint> = {
  owed_anchors: hint('run_tick', 'Run recurrence tick to record owed anchors', {
    command: 'recurrence tick',
  }),
  parent_not_paused: hint('pause_parent', 'Pause the recurring task with recurrence control', {
    command: 'recurrence control',
  }),
  future_pending: hint('cancel_future', 'Cancel future occurrences while the task is paused', {
    command: 'occurrence cancel',
  }),
  past_pending: hint('complete_occurrence', 'Complete occurrences whose deadline has passed', {
    command: 'occurrence complete',
  }),
  owed: hint('complete_occurrence', 'Owed occurrences cannot be cancelled. Complete them instead', {
    command: 'occurrence complete',
  }),
  not_pending: hint('read_revision', 'Re-read the occurrence list; these are no longer pending', {
    command: 'occurrence list',
  }),
};

const labels: Record<BlockerReason, string> = {
  owed_anchors: 'owed anchors',
  parent_not_paused: 'parent not paused',
  future_pending: 'future pending',
  past_pending: 'past pending',
  owed: 'owed',
  not_pending: 'not pending',
};

export type OpenOccurrence = { id: string; state: string; deadline: number };

/** Reason a single occurrence blocks a change at `now`. */
export function occurrenceReason(row: OpenOccurrence, now: number): BlockerReason {
  if (row.state === 'debt') return 'owed';
  if (row.state !== 'pending') return 'not_pending';
  return row.deadline > now ? 'future_pending' : 'past_pending';
}

/** Groups occurrences and extra reasons into ordered, bounded blockers. */
export function collectBlockers(
  rows: readonly OpenOccurrence[],
  options: { now: number; extra?: readonly BlockerReason[] },
): Blocker[] {
  const groups = new Map<BlockerReason, string[]>();
  for (const reason of options.extra ?? []) groups.set(reason, []);
  for (const row of rows) {
    const reason = occurrenceReason(row, options.now);
    groups.set(reason, [...(groups.get(reason) ?? []), row.id]);
  }
  return blockerReasons
    .filter((reason) => groups.has(reason))
    .map((reason) => {
      const ids = groups.get(reason) ?? [];
      return {
        reason,
        count: ids.length,
        occurrence_ids: ids.slice(0, diagnosticBounds.occurrenceIds),
        omitted: Math.max(0, ids.length - diagnosticBounds.occurrenceIds),
        step: steps[reason],
      };
    })
    .slice(0, diagnosticBounds.blockers);
}

/** "1 future pending, 2 owed"; reasons without occurrences are named alone. */
export function describeBlockers(blockers: readonly Blocker[]): string {
  return blockers
    .map((blocker) =>
      blocker.count > 0
        ? `${String(blocker.count)} ${labels[blocker.reason]}`
        : labels[blocker.reason],
    )
    .join(', ');
}

/** Ordered next steps for a refusal message. */
export function describeSteps(blockers: readonly Blocker[]): string {
  return blockers.map((blocker) => blocker.step.text).join('; ');
}
