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
  // Optional fields (spec 008 day_start_hour) are absent when default: absent reads as null.
  const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after)])];
  const read = (resource: object | null, field: string): unknown =>
    resource === null ? null : ((Reflect.get(resource, field) as unknown) ?? null);
  const changes = fields
    .filter((field) => before === null || read(before, field) !== read(after, field))
    .filter((field) => before !== null || Object.hasOwn(after, field))
    .map((field) => ({
      field,
      before: jsonValueSchema.parse(read(before, field)),
      after: jsonValueSchema.parse(read(after, field)),
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
