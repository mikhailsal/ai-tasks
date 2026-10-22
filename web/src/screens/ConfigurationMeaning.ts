import {
  categoryLabels,
  paletteLabels,
  modelLabels,
  type ConfigurationDraft,
} from '../components/configuration-model.js';
export function configurationMeaning(config: ConfigurationDraft) {
  function workflow(value: ConfigurationDraft['ordinary_workflow']) {
    return value.statuses
      .map(
        (status) =>
          `${status.label} (${status.id}): ${categoryLabels[status.category] ?? status.category}${status.color ? `, цвет ${paletteLabels[status.color] ?? status.color}` : ''}`,
      )
      .join('\n');
  }
  return {
    'Модель приоритета': modelLabels[config.priority_model.type] ?? config.priority_model.type,
    'Именованные уровни':
      config.priority_model.type === 'named'
        ? config.priority_model.levels
            .map(
              (level) =>
                `${level.label} (${level.id})${level.color ? `, цвет ${paletteLabels[level.color] ?? level.color}` : ''}`,
            )
            .join(' → ')
        : 'Не применяются',
    'Числовые границы':
      config.priority_model.type === 'numeric'
        ? `${config.priority_model.min} … ${config.priority_model.max}, ${config.priority_model.direction === 'lower' ? 'меньше — важнее' : 'больше — важнее'}`
        : 'Не применяются',
    'Обычные статусы': workflow(config.ordinary_workflow),
    'Обычные переходы': config.ordinary_workflow.transitions
      .map(
        (edge) =>
          `${edge.from} → ${edge.to}${edge.requires_confirmation ? ' — с явным подтверждением' : ''}`,
      )
      .join('\n'),
    'Повторяющиеся статусы': workflow(config.recurring_workflow),
    'Повторяющиеся переходы': config.recurring_workflow.transitions
      .map(
        (edge) =>
          `${edge.from} → ${edge.to}${edge.requires_confirmation ? ' — с явным подтверждением' : ''}`,
      )
      .join('\n'),
    'Начальные статусы': `${config.ordinary_workflow.initial_status_id} / ${config.recurring_workflow.initial_status_id}`,
    Восстановление: config.recurring_workflow.restore_status_id,
  };
}

const issueMessages: Readonly<Record<string, string>> = {
  VALIDATION_ERROR:
    'Заполните все обязательные соответствия, проверьте идентификаторы и точный список версий затронутых задач. Затем повторите предпросмотр.',
  REVISION_CONFLICT:
    'Задача изменилась после загрузки. Обновите предпросмотр и проверьте новые версии.',
  CONFIG_CONFLICT:
    'Настройки изменились в другом клиенте. Сравните текущую версию со своим вариантом перед повторным сохранением.',
  TASK_NOT_FOUND:
    'Затронутая задача больше не найдена. Обновите предпросмотр и проверьте список задач.',
  PROJECT_NOT_FOUND: 'Проект больше не найден. Вернитесь к списку проектов.',
  PROJECT_MISMATCH:
    'В список попала задача другого проекта. Проверьте область и обновите предпросмотр.',
  DEPENDENCY_BLOCKED:
    'Новое состояние требует завершённых предварительных задач. Завершите их или выберите другое соответствие статуса.',
  EMOJI_CONFLICT:
    'Эмодзи уже занят. Освободите маркер либо измените соответствие статуса и повторите предпросмотр.',
  DATABASE_EPOCH_CONFLICT:
    'База данных восстановлена. Сравните текущую конфигурацию со своим вариантом.',
};
export function configurationIssueMessage(code: string): string {
  return (
    issueMessages[code] ??
    'Изменения пока нельзя применить. Проверьте конфигурацию, соответствия и затронутые задачи, затем повторите предпросмотр.'
  );
}
