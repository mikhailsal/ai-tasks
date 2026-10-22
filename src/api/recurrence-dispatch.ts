import { createReadContext } from '../core/context.js';
import type { CoreContext } from '../core/database/types.js';
import { getSettings, updateSettings } from '../core/projects/settings.js';
import { getOccurrence, getRecurrence, listOccurrences } from '../core/queries/recurrence.js';
import { cancelOccurrences } from '../core/recurrence/cancel.js';
import { completeOccurrences } from '../core/recurrence/complete.js';
import { configureRecurrence, controlRecurrence } from '../core/recurrence/control.js';
import { tickRecurrence } from '../core/recurrence/tick.js';
import { parseInput } from '../core/validation.js';
import { occurrenceListInputSchema } from '../schema/recurrence-query.js';
import type { HelperCommand } from './helper-protocol.js';

type RecurrenceCommand = Extract<
  HelperCommand,
  { operation: `recurrence.${string}` | `occurrence.${string}` | `settings.${string}` }
>;
export function isRecurrenceCommand(command: HelperCommand): command is RecurrenceCommand {
  return (
    command.operation.startsWith('recurrence.') ||
    command.operation.startsWith('occurrence.') ||
    command.operation.startsWith('settings.')
  );
}
export function recurrenceDispatch(context: CoreContext, command: RecurrenceCommand) {
  const read = createReadContext({ connection: context.connection, now: context.now });
  if (command.operation === 'settings.get') return getSettings(read, command.scope);
  const slug = command.scope.project_slug;
  switch (command.operation) {
    case 'recurrence.get':
      return getRecurrence(read, slug, command.task_id);
    case 'recurrence.configure':
      return configureRecurrence(context, slug, command.task_id, command.input);
    case 'recurrence.control':
      return controlRecurrence(context, slug, command.task_id, command.input);
    case 'recurrence.tick':
      return tickRecurrence(context, slug, command.input);
    case 'occurrence.list':
      return listOccurrences(
        read,
        slug,
        command.task_id,
        parseInput(occurrenceListInputSchema, command.input),
      );
    case 'occurrence.get':
      return getOccurrence(read, slug, command.task_id, command.occurrence_id);
    case 'occurrence.complete':
      return completeOccurrences(context, slug, command.task_id, command.input);
    case 'occurrence.cancel':
      return cancelOccurrences(context, slug, command.task_id, command.input);
    case 'settings.update':
      return updateSettings(context, slug, command.input);
  }
}
