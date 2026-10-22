import * as z from 'zod/mini';
import {
  priorityValueSchema,
  validatePriorityForModel,
} from '../../../src/schema/configuration.js';
import { descriptionSchema, titleSchema } from '../../../src/schema/values.js';
import { readConfiguration, readProject, readTask, readSettings } from '../data/resources.js';
import { deadlineDraft, resolveLocalDeadline } from '../data/local-time.js';
import { recurrenceConfigurationSchema } from '../../../src/schema/recurrence-query.js';
import {
  blankRecurrenceFields,
  fieldsFromRecurrence,
  recurrenceFieldsSchema,
  recurrencePayload,
} from './recurrence-fields.js';
export const taskFieldsSchema = z.strictObject({
  title: z.string(),
  description: z.string(),
  emoji: z.string(),
  priority: priorityValueSchema,
  deadline: z.strictObject({ date: z.string(), time: z.string(), offset: z.string() }),
  timezone: z.string(),
  kind: z._default(z.enum(['ordinary', 'recurring']), 'ordinary'),
  recurrence: z._default(recurrenceFieldsSchema, blankRecurrenceFields),
});
export type TaskFields = z.infer<typeof taskFieldsSchema>;
export async function loadTaskPage(projectSlug: string, taskId?: string) {
  const [project, configuration, task, settings] = await Promise.all([
    readProject(projectSlug),
    readConfiguration(projectSlug),
    taskId ? readTask(projectSlug, taskId) : Promise.resolve(null),
    readSettings(projectSlug),
  ]);
  if (
    project.meta.database_epoch !== configuration.meta.database_epoch ||
    settings.meta.database_epoch !== project.meta.database_epoch ||
    (task && task.meta.database_epoch !== project.meta.database_epoch) ||
    project.data.config_revision !== configuration.data.revision ||
    (task && task.data.config_revision !== configuration.data.revision)
  )
    throw new Error('Настройки изменились во время загрузки. Обновите страницу.');
  return {
    project: project.data,
    configuration: configuration.data,
    task: task?.data ?? null,
    epoch: project.meta.database_epoch,
    timezone: settings.data.timezone,
    settingsRevision: settings.data.revision,
  };
}
export type TaskPage = Awaited<ReturnType<typeof loadTaskPage>>;
export function fieldsFromPage(page: TaskPage): TaskFields {
  return {
    title: page.task?.title ?? '',
    description: page.task?.description ?? '',
    emoji: page.task?.emoji ?? '⚪',
    priority: page.task?.priority ?? null,
    deadline: deadlineDraft(page.task?.deadline ?? null, page.timezone),
    timezone: page.timezone,
    ...taskKindFields(page),
  };
}
function taskKindFields(page: TaskPage) {
  const kind = page.task?.kind ?? 'ordinary';
  return {
    kind,
    recurrence:
      page.task?.kind === 'recurring'
        ? fieldsFromRecurrence(
            recurrenceConfigurationSchema.parse(page.task.recurrence),
            page.timezone,
          )
        : blankRecurrenceFields(),
  };
}
export function baseFromPage(page: TaskPage) {
  return {
    database_epoch: page.epoch,
    expected_config_revision: page.configuration.revision,
    expected_settings_revision: page.settingsRevision,
    ...(page.task ? { expected_revision: page.task.revision } : {}),
  };
}
export function taskPayload(fields: TaskFields, page: TaskPage) {
  if (!titleSchema.safeParse(fields.title).success)
    throw new Error('Название задачи должно содержать от 1 до 300 символов.');
  if (!descriptionSchema.safeParse(fields.description).success)
    throw new Error('Описание не должно превышать 100 000 символов.');
  try {
    validatePriorityForModel(fields.priority, page.configuration.priority_model);
  } catch {
    throw new Error('Проверьте приоритет по текущей модели проекта.');
  }
  return {
    title: fields.title,
    description: fields.description,
    emoji: fields.emoji,
    priority: fields.priority,
    ...taskTimingPayload(fields, page),
  };
}
function taskTimingPayload(fields: TaskFields, page: TaskPage) {
  if (page.task)
    return page.task.kind === 'ordinary'
      ? { deadline: resolveLocalDeadline(fields.deadline, fields.timezone) }
      : {};
  if (fields.kind === 'recurring')
    return { kind: 'recurring', recurrence: recurrencePayload(fields.recurrence, fields.timezone) };
  return { kind: 'ordinary', deadline: resolveLocalDeadline(fields.deadline, fields.timezone) };
}
