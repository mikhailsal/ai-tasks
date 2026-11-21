import type { JsonValue } from '../../../src/schema/values.js';
import type { TaskFields } from './task-model.js';

/**
 * The deadline as the form shows it, but with every part that changes the instant: seconds
 * and milliseconds when set, and the chosen offset for a repeated local time.
 */
function deadlineText(deadline: TaskFields['deadline']) {
  if (deadline.date === '') return null;
  const time = deadline.time.replace(/\.0+$/u, '').replace(/^(\d{2}:\d{2}):00$/u, '$1');
  const at = time === '' ? deadline.date : `${deadline.date} ${time}`;
  return deadline.offset === '' ? at : `${at} (UTC${deadline.offset})`;
}

/**
 * What a person compares after a conflict: the fields they can edit in the form, in the
 * form's own terms. Internal fields (timezone, kind, recurrence settings) stay out.
 */
export function taskConflictView(fields: TaskFields): Record<string, JsonValue> {
  return {
    title: fields.title,
    emoji: fields.emoji,
    description: fields.description,
    priority: fields.priority,
    ...(fields.kind === 'ordinary' ? { deadline: deadlineText(fields.deadline) } : {}),
  };
}
