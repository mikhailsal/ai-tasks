import {
  classicPriorityLabels,
  priorityValueSchema,
  projectConfigInputSchema,
} from '../../../src/schema/configuration.js';
import type { JsonValue } from '../../../src/schema/values.js';
import { categoryLabels } from '../components/configuration-model.js';
import { configurationDraft } from '../components/configuration-model.js';
import { configurationMeaning } from './ConfigurationMeaning.js';

const fields: Readonly<Record<string, string>> = {
  title: 'Название задачи',
  name: 'Название проекта',
  description: 'Описание',
  emoji: 'Эмодзи',
  status_id: 'Статус',
  board_position: 'Позиция на доске',
  category: 'Категория',
  priority: 'Приоритет',
  deadline: 'Срок',
  archived_at: 'Архив',
  revision: 'Версия',
  config_revision: 'Версия конфигурации',
  configuration: 'Конфигурация',
  kind: 'Вид задачи',
  created_at: 'Создано',
  updated_at: 'Изменено',
};
const actions: Readonly<Record<string, string>> = {
  'project.create': 'Проект создан',
  'project.update': 'Проект изменён',
  'project.archive': 'Проект архивирован',
  'project.restore': 'Проект восстановлен',
  'task.create': 'Задача создана',
  'task.update': 'Задача изменена',
  'task.transition': 'Статус задачи изменён',
  'task.position': 'Порядок или стадия задачи изменены',
  'task.archive': 'Задача архивирована',
  'task.restore': 'Задача восстановлена',
  'config.migrate': 'Конфигурация изменена',
  'dependency.add': 'Добавлена зависимость',
  'dependency.remove': 'Удалена зависимость',
};
export function auditField(field: string): string {
  return Object.hasOwn(fields, field) ? (fields[field] ?? field) : field;
}
export function auditAction(action: string): string {
  return Object.hasOwn(actions, action) ? (actions[action] ?? action) : action;
}

export function capturedConfiguration(snapshot: JsonValue) {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot))
    return undefined;
  const parsed = projectConfigInputSchema.safeParse({
    priority_model: snapshot.priority_model,
    ordinary_workflow: snapshot.ordinary_workflow,
    recurring_workflow: snapshot.recurring_workflow,
  });
  return parsed.success ? parsed.data : undefined;
}

export function previousSnapshot(snapshot: JsonValue): JsonValue {
  if (
    snapshot !== null &&
    typeof snapshot === 'object' &&
    !Array.isArray(snapshot) &&
    Object.hasOwn(snapshot, 'previous')
  )
    return snapshot.previous ?? null;
  return snapshot;
}

function statusMeaning(value: string, snapshot: JsonValue): string {
  const config = capturedConfiguration(snapshot);
  if (!config) return value;
  return (
    [
      { label: 'Обычные задачи', workflow: config.ordinary_workflow },
      { label: 'Повторяющиеся задачи', workflow: config.recurring_workflow },
    ]
      .flatMap(({ label, workflow }) =>
        workflow.statuses
          .filter((status) => status.id === value)
          .map(
            (status) =>
              `${label}: ${status.label} (${status.id}) · ${categoryLabels[status.category] ?? status.category}`,
          ),
      )
      .join('\n') || value
  );
}

export function auditValue(field: string, value: JsonValue, snapshot: JsonValue): string {
  if (value === null) return 'Не задано';
  if (field === 'status_id' && typeof value === 'string') return statusMeaning(value, snapshot);
  if (field === 'category' && typeof value === 'string')
    return `${categoryLabels[value] ?? value} (${value})`;
  if (field === 'configuration') {
    const config = capturedConfiguration(value);
    if (config)
      return Object.entries(configurationMeaning(configurationDraft(config)))
        .map(([name, text]) => `${name}: ${text}`)
        .join('\n');
  }
  if (field === 'priority') return priorityMeaning(value, snapshot) ?? plainValue(value);
  return plainValue(value);
}

function plainValue(value: JsonValue): string {
  if (value === null) return 'Не задано';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  return JSON.stringify(value, null, 2);
}

function priorityMeaning(value: JsonValue, snapshot: JsonValue): string | undefined {
  const parsed = priorityValueSchema.safeParse(value);
  if (!parsed.success || !parsed.data) return undefined;
  const priority = parsed.data;
  switch (priority.model) {
    case 'classic':
      return classicPriorityLabels[priority.level];
    case 'numeric':
      return String(priority.value);
    case 'eisenhower':
      return `Важно: ${priority.important ? 'да' : 'нет'}, срочно: ${priority.urgent ? 'да' : 'нет'}`;
    case 'named':
      return namedPriorityMeaning(priority.level_id, snapshot);
  }
}

function namedPriorityMeaning(id: string, snapshot: JsonValue): string {
  const model = capturedConfiguration(snapshot)?.priority_model;
  if (model?.type !== 'named') return id;
  const label = model.levels.find((level) => level.id === id)?.label;
  return label ? `${label} (${id})` : id;
}
