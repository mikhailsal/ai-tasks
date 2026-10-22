import * as z from 'zod/mini';
import {
  errorEnvelopeSchema,
  mutationEnvelopeSchema,
  successEnvelopeSchema,
} from '../schema/envelopes.js';
import { errorCodeSchema } from '../schema/errors.js';
import { readScopeSchema } from '../schema/scopes.js';
import { recoveryJobEnvelopeSchema } from '../schema/recovery.js';
import { backupListInputSchema } from '../schema/recovery.js';
import { jsonValueSchema, slugSchema, uuidSchema, type JsonValue } from '../schema/values.js';
const projectScope = z.strictObject({ project_slug: slugSchema });
const queryInput = z.custom<Record<string, JsonValue>>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    jsonValueSchema.safeParse(value).success,
);
const mutation = { scope: projectScope, input: mutationEnvelopeSchema };
const taskMutation = { ...mutation, task_id: uuidSchema };
const commands = [
  z.strictObject({
    operation: z.literal('meta'),
    scope: z.strictObject({ all_projects: z.literal(true) }),
  }),
  z.strictObject({ operation: z.literal('audit.list'), input: queryInput }),
  z.strictObject({ operation: z.literal('agenda.list'), input: queryInput }),
  z.strictObject({ operation: z.literal('priorities.list'), input: queryInput }),
  z.strictObject({ operation: z.literal('stats.get'), input: queryInput }),
  z.strictObject({ operation: z.literal('project.list'), input: queryInput }),
  z.strictObject({ operation: z.literal('project.get'), scope: projectScope }),
  z.strictObject({ operation: z.literal('project.create'), ...mutation }),
  z.strictObject({ operation: z.literal('project.update'), ...mutation }),
  z.strictObject({ operation: z.literal('project.archive'), ...mutation }),
  z.strictObject({ operation: z.literal('project.restore'), ...mutation }),
  z.strictObject({ operation: z.literal('task.list'), input: queryInput }),
  z.strictObject({ operation: z.literal('task.get'), scope: projectScope, task_id: uuidSchema }),
  z.strictObject({ operation: z.literal('task.create'), ...mutation }),
  z.strictObject({ operation: z.literal('task.update'), ...taskMutation }),
  z.strictObject({ operation: z.literal('task.transition'), ...taskMutation }),
  z.strictObject({ operation: z.literal('task.archive'), ...taskMutation }),
  z.strictObject({ operation: z.literal('task.restore'), ...taskMutation }),
  z.strictObject({ operation: z.literal('config.presets'), scope: readScopeSchema }),
  z.strictObject({ operation: z.literal('config.get'), scope: projectScope }),
  z.strictObject({
    operation: z.literal('config.preview'),
    scope: projectScope,
    input: jsonValueSchema,
  }),
  z.strictObject({ operation: z.literal('config.migrate'), ...mutation }),
  z.strictObject({
    operation: z.literal('dependency.list'),
    scope: projectScope,
    task_id: uuidSchema,
  }),
  z.strictObject({ operation: z.literal('dependency.add'), ...taskMutation }),
  z.strictObject({ operation: z.literal('dependency.remove'), ...taskMutation }),
  z.strictObject({
    operation: z.literal('recurrence.get'),
    scope: projectScope,
    task_id: uuidSchema,
  }),
  z.strictObject({ operation: z.literal('recurrence.configure'), ...taskMutation }),
  z.strictObject({ operation: z.literal('recurrence.control'), ...taskMutation }),
  z.strictObject({ operation: z.literal('recurrence.tick'), ...mutation }),
  z.strictObject({
    operation: z.literal('occurrence.list'),
    scope: projectScope,
    task_id: uuidSchema,
    input: queryInput,
  }),
  z.strictObject({
    operation: z.literal('occurrence.get'),
    scope: projectScope,
    task_id: uuidSchema,
    occurrence_id: uuidSchema,
  }),
  z.strictObject({ operation: z.literal('occurrence.complete'), ...taskMutation }),
  z.strictObject({ operation: z.literal('occurrence.cancel'), ...taskMutation }),
  z.strictObject({
    operation: z.literal('backup.create'),
    ...mutation,
  }),
  z.strictObject({ operation: z.literal('backup.list'), input: backupListInputSchema }),
  z.strictObject({
    operation: z.literal('backup.validate'),
    backup_id: uuidSchema,
    scope: z.strictObject({ all_projects: z.literal(true) }),
  }),
  z.strictObject({
    operation: z.literal('backup.restore.accept'),
    ...mutation,
    caller: z.enum(['web', 'cli']),
  }),
  z.strictObject({ operation: z.literal('settings.get'), scope: readScopeSchema }),
  z.strictObject({ operation: z.literal('settings.update'), ...mutation }),
  z.strictObject({
    operation: z.literal('description.preview'),
    scope: projectScope,
    input: z.strictObject({ description: z.string() }),
  }),
] as const;
export const helperCommandSchema = z.discriminatedUnion('operation', commands);
const [firstCommand, ...otherCommands] = commands;
const ipc = { type: z.literal('request'), id: uuidSchema };
export const helperRequestSchema = z.discriminatedUnion('operation', [
  z.extend(firstCommand, ipc),
  ...otherCommands.map((command) => z.extend(command, ipc)),
]);
const helperErrorEnvelopeSchema = z.extend(errorEnvelopeSchema, {
  error: z.extend(errorEnvelopeSchema.shape.error, { code: errorCodeSchema }),
});
export const helperMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready') }),
  z.strictObject({
    type: z.literal('response'),
    id: uuidSchema,
    envelope: z.union([successEnvelopeSchema, helperErrorEnvelopeSchema]),
  }),
  z.strictObject({ type: z.literal('fatal'), error: helperErrorEnvelopeSchema }),
]);
export type HelperCommand = z.infer<typeof helperCommandSchema>;

export type HelperRequest = z.infer<typeof helperRequestSchema>;
export const restoreAcceptanceEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: z.strictObject({ receipt: recoveryJobEnvelopeSchema, published: z.boolean() }),
});
export type RestoreAcceptanceEnvelope = z.output<typeof restoreAcceptanceEnvelopeSchema>;
