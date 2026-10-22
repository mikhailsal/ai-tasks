import {
  projectConfigInputSchema,
  ordinaryWorkflowSchema,
  recurringWorkflowSchema,
  priorityModelSchema,
  type PriorityModel,
} from '../../schema/configuration.js';

export function createDefaultOrdinaryWorkflow() {
  const pairs = [
    ['idea', 'planning'],
    ['planning', 'ready'],
    ['ready', 'in_progress'],
    ['in_progress', 'sanity_check'],
    ['sanity_check', 'done'],
    ['planning', 'idea'],
    ['ready', 'planning'],
    ['in_progress', 'ready'],
    ['sanity_check', 'in_progress'],
    ['done', 'sanity_check'],
    ['done', 'in_progress'],
    ['idea', 'cancelled'],
    ['planning', 'cancelled'],
    ['ready', 'cancelled'],
    ['in_progress', 'cancelled'],
    ['sanity_check', 'cancelled'],
    ['cancelled', 'idea'],
  ] as const;
  return ordinaryWorkflowSchema.parse({
    initial_status_id: 'idea',
    statuses: [
      { id: 'idea', label: 'Идея', category: 'not_started' },
      { id: 'planning', label: 'Планирование', category: 'not_started' },
      { id: 'ready', label: 'Готово к работе', category: 'not_started' },
      { id: 'in_progress', label: 'В работе', category: 'in_progress' },
      { id: 'sanity_check', label: 'Проверка', category: 'review' },
      { id: 'done', label: 'Готово', category: 'completed' },
      { id: 'cancelled', label: 'Отменено', category: 'cancelled' },
    ],
    transitions: pairs.map(([from, to]) => ({
      from,
      to,
      requires_confirmation: from === 'sanity_check' && to === 'done',
    })),
  });
}

export function createDefaultRecurringWorkflow() {
  const pairs = [
    ['draft', 'active'],
    ['draft', 'archived'],
    ['active', 'paused'],
    ['active', 'archived'],
    ['paused', 'active'],
    ['paused', 'archived'],
    ['archived', 'paused'],
  ] as const;
  return recurringWorkflowSchema.parse({
    initial_status_id: 'draft',
    restore_status_id: 'paused',
    statuses: [
      { id: 'draft', label: 'Черновик', category: 'draft' },
      { id: 'active', label: 'Активно', category: 'active' },
      { id: 'paused', label: 'Пауза', category: 'paused' },
      { id: 'archived', label: 'Архив', category: 'archived' },
    ],
    transitions: pairs.map(([from, to]) => ({ from, to, requires_confirmation: false })),
  });
}

export function createDefaultProjectConfig(model: PriorityModel = { type: 'classic' }) {
  return projectConfigInputSchema.parse({
    priority_model: priorityModelSchema.parse(model),
    ordinary_workflow: createDefaultOrdinaryWorkflow(),
    recurring_workflow: createDefaultRecurringWorkflow(),
  });
}

export function getBuiltinPresets() {
  const models = [
    { type: 'classic' },
    { type: 'eisenhower' },
    {
      type: 'named',
      levels: [
        { id: 'high', label: 'Высокий', color: 'red' },
        { id: 'normal', label: 'Обычный', color: 'blue' },
        { id: 'low', label: 'Низкий', color: 'slate' },
      ],
    },
    { type: 'numeric', min: 0, max: 100, direction: 'higher' },
  ];
  return {
    priority_models: models.map((model) => priorityModelSchema.parse(model)),
    ordinary_workflow: createDefaultOrdinaryWorkflow(),
    recurring_workflow: createDefaultRecurringWorkflow(),
  };
}
