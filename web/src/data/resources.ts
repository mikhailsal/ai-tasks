import { z } from 'zod/mini';
import {
  ordinaryWorkflowSchema,
  priorityModelSchema,
  projectConfigInputSchema,
  recurringWorkflowSchema,
} from '../../../src/schema/configuration.js';
import { successEnvelopeSchema } from '../../../src/schema/envelopes.js';
import { projectResourceSchema } from '../../../src/schema/projects.js';
import { taskDetailSchema, taskResourceSchema } from '../../../src/schema/tasks.js';
import { settingsEnvelopeSchema } from '../../../src/schema/settings.js';
import { revisionSchema } from '../../../src/schema/values.js';
import { ApiClientError, getApi } from './api.js';
export const projectEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: projectResourceSchema,
});
export const taskEnvelopeSchema = z.extend(successEnvelopeSchema, { data: taskDetailSchema });
export const projectPageSchema = z.extend(successEnvelopeSchema, {
  data: z.strictObject({
    items: z.array(projectResourceSchema),
    next_cursor: z.nullable(z.string()),
  }),
});
export const taskPageSchema = z.extend(successEnvelopeSchema, {
  data: z.strictObject({ items: z.array(taskResourceSchema), next_cursor: z.nullable(z.string()) }),
});
export const configurationEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: z.extend(projectConfigInputSchema, { revision: revisionSchema }),
});
export const presetsEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: z.strictObject({
    priority_models: z.array(priorityModelSchema),
    ordinary_workflow: ordinaryWorkflowSchema,
    recurring_workflow: recurringWorkflowSchema,
  }),
});
export function readProject(slug: string, signal?: AbortSignal) {
  return getApi(`/projects/${encodeURIComponent(slug)}`, projectEnvelopeSchema, signal);
}
export function readTask(slug: string, id: string, signal?: AbortSignal) {
  return getApi(
    `/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(id)}`,
    taskEnvelopeSchema,
    signal,
  );
}
export function readConfiguration(slug: string, signal?: AbortSignal) {
  return getApi(
    `/projects/${encodeURIComponent(slug)}/config`,
    configurationEnvelopeSchema,
    signal,
  );
}
export function readSettings(projectSlug?: string, signal?: AbortSignal) {
  const query =
    projectSlug === undefined
      ? 'all_projects=true'
      : `project_slug=${encodeURIComponent(projectSlug)}`;
  return getApi(`/settings?${query}`, settingsEnvelopeSchema, signal);
}
export function readPresets(signal?: AbortSignal) {
  return getApi('/config/presets?all_projects=true', presetsEnvelopeSchema, signal);
}
/** Administrative archive/restore guards cover every child, including terminal/archive. */
export async function collectProjectTasks(slug: string, signal?: AbortSignal) {
  const items: z.output<typeof taskResourceSchema>[] = [];
  let cursor: string | null = null;
  do {
    const query: URLSearchParams = new URLSearchParams({
      project_slug: slug,
      archive: 'include',
      include_terminal: 'true',
      limit: '200',
      ...(cursor === null ? {} : { cursor }),
    });
    const page: z.output<typeof taskPageSchema> = await getApi(
      `/tasks?${query.toString()}`,
      taskPageSchema,
      signal,
    );
    items.push(...page.data.items);
    cursor = page.data.next_cursor;
  } while (cursor !== null);
  return items;
}
const messages: Readonly<Record<string, string>> = {
  EMOJI_CONFLICT: 'Этот эмодзи уже занят. Выберите другой эмодзи.',
  REVISION_CONFLICT: 'Данные изменились в другом клиенте. Сравните версии перед сохранением.',
  CONFIG_CONFLICT: 'Настройки проекта изменились. Проверьте свой вариант по новой конфигурации.',
  DATABASE_EPOCH_CONFLICT:
    'База данных восстановлена. Проверьте свой вариант перед новым сохранением.',
  IDEMPOTENCY_CONFLICT: 'Эта операция уже использована с другими данными. Проверьте свой вариант.',
  CURSOR_STALE: 'Список изменился. Обновите его с первой страницы.',
  DEPENDENCY_BLOCKED: 'Сначала завершите задачи, от которых зависит эта работа.',
  CONFIRMATION_REQUIRED: 'Для этого перехода нужен текст вашего подтверждения.',
  VALIDATION_ERROR: 'Проверьте заполненные поля. Данные не сохранены.',
  PROJECT_NOT_FOUND: 'Проект не найден.',
  TASK_NOT_FOUND: 'Задача не найдена.',
  PROJECT_MISMATCH: 'Задача принадлежит другому проекту.',
  DB_CONFLICT: 'База данных занята. Повторите ту же операцию.',
  MAINTENANCE: 'Приложение временно недоступно. Сохраните свой вариант и повторите позже.',
};
export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (
      error.code === 'DEPENDENCY_BLOCKED' &&
      error.details !== null &&
      typeof error.details === 'object' &&
      !Array.isArray(error.details) &&
      error.details.reason === 'cycle'
    )
      return 'Эта зависимость создаёт цикл. Выберите другую предварительную задачу.';
    return messages[error.code] ?? error.message;
  }
  return error instanceof Error ? error.message : 'Не удалось выполнить действие.';
}
