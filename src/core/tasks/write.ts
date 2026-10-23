import { syncBoardMembership } from './board-order.js';
import type { z } from 'zod/mini';
import type { projects, tasks } from '../../schema/entities.js';
import type { ProjectConfigInput } from '../../schema/configuration.js';
import type { confirmationSchema } from '../../schema/tasks.js';
import { jsonValueSchema } from '../../schema/values.js';
import type { DatabaseTransaction } from '../database/types.js';
import type { AuditEvent } from '../audit/append.js';
import { readTaskDetail, taskResource } from './read.js';
export function taskMutationResult(
  transaction: DatabaseTransaction,
  options: {
    before: typeof tasks.$inferSelect | null;
    after: typeof tasks.$inferSelect;
    project: typeof projects.$inferSelect;
    config: ProjectConfigInput;
    action: string;
    confirmation?: z.infer<typeof confirmationSchema>;
  },
) {
  const before =
    options.before === null ? null : taskResource(options.before, options.project, options.config);
  const after = taskResource(options.after, options.project, options.config);
  const changes = Object.entries(after)
    .filter(
      ([field, value]) =>
        before === null || JSON.stringify(Reflect.get(before, field)) !== JSON.stringify(value),
    )
    .map(([field, value]) => ({
      field,
      before: jsonValueSchema.parse(before === null ? null : Reflect.get(before, field)),
      after: jsonValueSchema.parse(value),
    }));
  const boardChange = syncBoardMembership(transaction, options);
  if (boardChange) changes.push(boardChange);
  const event: AuditEvent = {
    entity_type: 'task',
    entity_id: options.after.id,
    action: options.action,
    changes,
    config_snapshot: jsonValueSchema.parse({
      revision: options.project.configRevision,
      ...options.config,
    }),
    ...(options.confirmation === undefined ? {} : { confirmation: options.confirmation }),
  };
  return {
    data: jsonValueSchema.parse(
      readTaskDetail(transaction, {
        task: options.after,
        project: options.project,
        config: options.config,
      }),
    ),
    events: [event],
  };
}
