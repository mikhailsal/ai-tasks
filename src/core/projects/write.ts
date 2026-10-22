import type { projects } from '../../schema/entities.js';
import { jsonValueSchema } from '../../schema/values.js';
import type { ProjectConfigInput } from '../../schema/configuration.js';
import type { AuditEvent } from '../audit/append.js';
import { projectResource } from './read.js';

export function projectMutationResult(options: {
  before: typeof projects.$inferSelect | null;
  after: typeof projects.$inferSelect;
  config: ProjectConfigInput;
  action: string;
}) {
  const before = options.before === null ? null : projectResource(options.before);
  const after = projectResource(options.after);
  const changes = Object.entries(after)
    .filter(([key, value]) => before === null || Reflect.get(before, key) !== value)
    .map(([field, value]) => ({
      field,
      before: jsonValueSchema.parse(before === null ? null : Reflect.get(before, field)),
      after: jsonValueSchema.parse(value),
    }));
  if (before === null)
    changes.push({
      field: 'configuration',
      before: null,
      after: jsonValueSchema.parse(options.config),
    });
  const event: AuditEvent = {
    entity_type: 'project',
    entity_id: options.after.id,
    action: options.action,
    changes,
    config_snapshot: jsonValueSchema.parse({
      revision: options.after.configRevision,
      ...options.config,
    }),
  };
  return { data: jsonValueSchema.parse(after), events: [event] };
}
