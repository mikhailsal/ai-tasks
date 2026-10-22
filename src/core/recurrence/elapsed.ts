import {
  afterCompletionScheduleSchema,
  type AfterCompletionSchedule,
} from '../../schema/recurrence-input.js';
import { readClock } from '../time.js';
import { parseInput } from '../validation.js';

/** Completion-relative days are exactly 24 hours, independent of timezone and DST. */
export function nextElapsedDeadline(options: {
  schedule: AfterCompletionSchedule;
  actualCompletedAt: number;
}): number {
  const schedule = parseInput(afterCompletionScheduleSchema, options.schedule);
  const actual = readClock(() => options.actualCompletedAt);
  const hours = schedule.every * (schedule.unit === 'days' ? 24 : 1);
  return readClock(() => actual + hours * 3_600_000);
}
