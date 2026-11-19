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
  'recurrence.configure': 'Повторение настроено',
  'recurrence.control': 'Повторение включено, приостановлено или остановлено',
  'recurrence.tick': 'Обработаны наступившие сроки',
  'recurrence.timezone': 'Часовой пояс повторения изменён',
  'occurrence.complete': 'Повторение выполнено',
  'occurrence.cancel': 'Повторение отменено',
  'occurrence.miss': 'Пропуск записан',
  'settings.update': 'Настройки изменены',
  'database.restore': 'База данных восстановлена',
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

type Meaning = (value: JsonValue, snapshot: JsonValue) => string | undefined;
const meanings: Readonly<Record<string, Meaning>> = {
  status_id: (value, snapshot) =>
    typeof value === 'string' ? statusMeaning(value, snapshot) : undefined,
  category: (value) =>
    typeof value === 'string' ? `${categoryLabels[value] ?? value} (${value})` : undefined,
  configuration: (value) => {
    const config = capturedConfiguration(value);
    return config
      ? Object.entries(configurationMeaning(configurationDraft(config)))
          .map(([name, text]) => `${name}: ${text}`)
          .join('\n')
      : undefined;
  },
  priority: priorityMeaning,
  board_position: boardPosition,
};

export function auditValue(field: string, value: JsonValue, snapshot: JsonValue): string {
  if (value === null) return 'Не задано';
  const meaning = Object.hasOwn(meanings, field) ? meanings[field] : undefined;
  return meaning?.(value, snapshot) ?? plainValue(value);
}

/** `{status_id, position}` as «Стадия «Черновик», позиция 2» (QA F9), not raw JSON. */
function boardPosition(value: JsonValue, snapshot: JsonValue): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { status_id: id, position } = value;
  if (typeof id !== 'string' || typeof position !== 'number') return undefined;
  const config = capturedConfiguration(snapshot);
  const label = [
    ...(config?.ordinary_workflow.statuses ?? []),
    ...(config?.recurring_workflow.statuses ?? []),
  ].find((status) => status.id === id)?.label;
  return `Стадия «${label ?? id}», позиция ${String(position)}`;
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
