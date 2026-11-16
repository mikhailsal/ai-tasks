import * as z from 'zod/mini';
import { configKeySchema, jsonValueSchema } from '../../schema/values.js';

const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
import type { CoreContext } from '../database/types.js';
import { executeShortcut } from '../database/shortcut.js';
import { domainError } from '../errors.js';
import { readProjectConfiguration, requireProject } from '../projects/read.js';
import { taskResource } from '../tasks/read.js';
import { applyTaskTransition } from '../tasks/transitions.js';
import { parseInput } from '../validation.js';
import { nameTask } from './name-task.js';
import { strictTokens } from './tokens.js';

export const taskMoveSchema = z.strictObject({
  task: z.string().check(z.minLength(1)),
  to: configKeySchema,
  from: z.optional(configKeySchema),
  confirmation: z.optional(jsonValueSchema),
});

/** `task move` (spec 009 US2): the strict `task transition`, revisions filled under the lock. */
export function moveTask(context: CoreContext, projectSlug: string, raw: unknown) {
  const input = parseInput(taskMoveSchema, raw);
  return executeShortcut({
    context,
    operation: 'task.transition',
    projectSlug,
    resolve(transaction) {
      const project = requireProject(transaction, projectSlug);
      const config = readProjectConfiguration(transaction, project);
      const task = nameTask(transaction, projectSlug, input.task);
      if (input.from !== undefined && input.from !== task.statusId)
        throw domainError(
          'VALIDATION_ERROR',
          `The task is in ${task.statusId}, not ${input.from}; nothing was changed`,
          { entity_id: task.id, field: 'from', actual_status: task.statusId },
        );
      if (task.statusId === input.to)
        return {
          kind: 'existing',
          data: jsonObjectSchema.parse(taskResource(task, project, config)),
        };
      const workflow =
        task.kind === 'recurring' ? config.recurring_workflow : config.ordinary_workflow;
      const allowed = workflow.transitions
        .filter((edge) => edge.from === task.statusId)
        .map((edge) => edge.to);
      if (!allowed.includes(input.to))
        throw domainError('VALIDATION_ERROR', 'This transition is not in the project workflow', {
          entity_id: task.id,
          field: 'to',
          from: task.statusId,
          allowed,
        });
      return {
        kind: 'write',
        tokens: strictTokens(transaction, 'task.transition', { task, project }),
        payload: {
          to_status_id: input.to,
          ...(input.confirmation === undefined ? {} : { confirmation: input.confirmation }),
        },
        guards: { entity: { type: 'task', id: task.id } },
        handler: (envelope) => (tx, now) =>
          applyTaskTransition(tx, { projectSlug, taskId: task.id, input: envelope, now }),
      };
    },
  });
}
