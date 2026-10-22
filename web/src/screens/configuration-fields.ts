import * as z from 'zod/mini';
import { jsonValueSchema } from '../../../src/schema/values.js';
import { priorityValueSchema } from '../../../src/schema/configuration.js';
import {
  configurationMigrationSchema,
  type configurationPreviewEnvelopeSchema,
} from '../../../src/schema/configuration-migration.js';
import { configurationDraftSchema, configurationInput } from '../components/configuration-model.js';
export type ConfigurationPreview = z.output<typeof configurationPreviewEnvelopeSchema>['data'];
// Targets are editable draft values; numeric precision and named-ID validity are submit rules.
const priorityTargetDraftSchema = z.nullable(
  z.discriminatedUnion('model', [
    z.strictObject({
      model: z.literal('classic'),
      level: z.enum(['critical', 'high', 'normal', 'low']),
    }),
    z.strictObject({ model: z.literal('named'), level_id: z.string() }),
    z.strictObject({ model: z.literal('numeric'), value: z.number() }),
    z.strictObject({ model: z.literal('eisenhower'), important: z.boolean(), urgent: z.boolean() }),
  ]),
);
export const configurationFieldsSchema = z.strictObject({
  config: configurationDraftSchema,
  status_mappings: z.array(
    z.strictObject({ kind: z.string(), from_status_id: z.string(), to_status_id: z.string() }),
  ),
  priority_mappings: z.array(
    z.strictObject({
      from: priorityValueSchema,
      to: priorityTargetDraftSchema,
      selected: z.boolean(),
    }),
  ),
  affected_tasks: z.array(z.strictObject({ task_id: z.string(), expected_revision: z.number() })),
});
export type ConfigurationFields = z.infer<typeof configurationFieldsSchema>;
export function migrationInput(fields: ConfigurationFields) {
  const parsed = configurationMigrationSchema.safeParse({
    config: configurationInput(fields.config),
    status_mappings: fields.status_mappings.filter((mapping) => mapping.to_status_id !== ''),
    priority_mappings: fields.priority_mappings
      .filter((mapping) => mapping.selected)
      .map(({ from, to }) => ({ from, to })),
    affected_tasks: fields.affected_tasks,
  });
  if (!parsed.success)
    throw new Error('Проверьте соответствия статусов, приоритетов и версии затронутых задач.');
  return jsonValueSchema.parse(parsed.data);
}
export function priorityKey(value: z.infer<typeof priorityValueSchema>) {
  if (value === null) return 'unset';
  switch (value.model) {
    case 'classic':
      return value.level;
    case 'named':
      return value.level_id;
    case 'numeric':
      return String(value.value);
    case 'eisenhower':
      return `${value.important ? 'Важно' : 'Не важно'}, ${value.urgent ? 'срочно' : 'не срочно'}`;
  }
}
