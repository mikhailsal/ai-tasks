import * as z from 'zod/mini';
import {
  projectConfigInputSchema,
  type ProjectConfigInput,
} from '../../../src/schema/configuration.js';
const statusDraftSchema = z.strictObject({
  id: z.string(),
  label: z.string(),
  category: z.string(),
  color: z.string(),
});
const workflowDraftSchema = z.strictObject({
  initial_status_id: z.string(),
  restore_status_id: z.string(),
  statuses: z.array(statusDraftSchema),
  transitions: z.array(
    z.strictObject({ from: z.string(), to: z.string(), requires_confirmation: z.boolean() }),
  ),
});
export const configurationDraftSchema = z.strictObject({
  priority_model: z.strictObject({
    type: z.string(),
    min: z.string(),
    max: z.string(),
    direction: z.string(),
    levels: z.array(z.strictObject({ id: z.string(), label: z.string(), color: z.string() })),
  }),
  ordinary_workflow: workflowDraftSchema,
  recurring_workflow: workflowDraftSchema,
});
export type ConfigurationDraft = z.infer<typeof configurationDraftSchema>;
export type WorkflowDraft = ConfigurationDraft['ordinary_workflow'];
export const paletteLabels: Record<string, string> = {
  slate: 'Серый',
  red: 'Красный',
  orange: 'Оранжевый',
  amber: 'Янтарный',
  green: 'Зелёный',
  teal: 'Бирюзовый',
  blue: 'Синий',
  indigo: 'Индиго',
  violet: 'Фиолетовый',
  rose: 'Розовый',
};
export const categoryLabels: Record<string, string> = {
  not_started: 'Не начато',
  in_progress: 'В работе',
  review: 'Проверка',
  completed: 'Завершено',
  cancelled: 'Отменено',
  draft: 'Черновик',
  active: 'Активно',
  paused: 'Пауза',
  archived: 'В архиве',
};
export const modelLabels: Record<string, string> = {
  classic: 'Классический',
  eisenhower: 'Матрица Эйзенхауэра',
  named: 'Именованные уровни',
  numeric: 'Числовой',
};
export function configurationDraft(config: ProjectConfigInput): ConfigurationDraft {
  const model = config.priority_model;
  function workflow(
    value: ProjectConfigInput['ordinary_workflow'] | ProjectConfigInput['recurring_workflow'],
  ) {
    return {
      ...value,
      restore_status_id: 'restore_status_id' in value ? value.restore_status_id : '',
      statuses: value.statuses.map((status) => ({ ...status, color: status.color ?? '' })),
    };
  }
  return {
    priority_model: {
      type: model.type,
      min: model.type === 'numeric' ? String(model.min) : '0',
      max: model.type === 'numeric' ? String(model.max) : '100',
      direction: model.type === 'numeric' ? model.direction : 'higher',
      levels:
        model.type === 'named'
          ? model.levels.map((level) => ({ ...level, color: level.color ?? '' }))
          : [{ id: 'first', label: 'Сначала', color: 'red' }],
    },
    ordinary_workflow: workflow(config.ordinary_workflow),
    recurring_workflow: workflow(config.recurring_workflow),
  };
}
function workflowInput(workflow: WorkflowDraft, recurring: boolean) {
  return {
    initial_status_id: workflow.initial_status_id,
    ...(recurring ? { restore_status_id: workflow.restore_status_id } : {}),
    statuses: workflow.statuses.map(({ color, ...status }) => ({
      ...status,
      ...(color ? { color } : {}),
    })),
    transitions: workflow.transitions,
  };
}
export function configurationInput(draft: ConfigurationDraft): ProjectConfigInput {
  const model = draft.priority_model;
  const priority_model =
    model.type === 'numeric'
      ? {
          type: model.type,
          min: model.min.trim() ? Number(model.min) : null,
          max: model.max.trim() ? Number(model.max) : null,
          direction: model.direction,
        }
      : model.type === 'named'
        ? {
            type: model.type,
            levels: model.levels.map(({ color, ...level }) => ({
              ...level,
              ...(color ? { color } : {}),
            })),
          }
        : { type: model.type };
  const result = projectConfigInputSchema.safeParse({
    priority_model,
    ordinary_workflow: workflowInput(draft.ordinary_workflow, false),
    recurring_workflow: workflowInput(draft.recurring_workflow, true),
  });
  if (!result.success) throw new Error(configurationProblem(draft));
  return result.data;
}
export function configurationProblem(draft: ConfigurationDraft): string {
  const workflows = [draft.ordinary_workflow, draft.recurring_workflow];
  if (
    workflows.some(
      (flow) => new Set(flow.statuses.map((status) => status.id)).size !== flow.statuses.length,
    )
  )
    return 'Идентификаторы статусов должны быть уникальными. Исправьте повторяющийся идентификатор.';
  if (workflows.some((flow) => flow.statuses.length > 100 || flow.statuses.length === 0))
    return 'В каждом рабочем процессе должно быть от 1 до 100 статусов.';
  if (
    draft.priority_model.type === 'named' &&
    new Set(draft.priority_model.levels.map((level) => level.id)).size !==
      draft.priority_model.levels.length
  )
    return 'Идентификаторы уровней должны быть уникальными. Исправьте повторяющийся идентификатор.';
  if (draft.priority_model.levels.length > 100)
    return 'Допускается не больше 100 именованных уровней.';
  return 'Проверьте идентификаторы, названия (1–80 символов), категории, начальный статус, переходы и приоритет. Числовые границы должны различаться и иметь не больше трёх знаков после запятой.';
}
export function renameStatus(workflow: WorkflowDraft, index: number, id: string): WorkflowDraft {
  const previous = workflow.statuses[index]?.id;
  const unique =
    previous !== undefined &&
    workflow.statuses.filter((status) => status.id === previous).length === 1 &&
    !workflow.statuses.some((status, position) => position !== index && status.id === id);
  return {
    ...workflow,
    statuses: workflow.statuses.map((status, position) =>
      position === index ? { ...status, id } : status,
    ),
    initial_status_id:
      unique && workflow.initial_status_id === previous ? id : workflow.initial_status_id,
    restore_status_id:
      unique && workflow.restore_status_id === previous ? id : workflow.restore_status_id,
    transitions: unique
      ? workflow.transitions.map((edge) => ({
          ...edge,
          from: edge.from === previous ? id : edge.from,
          to: edge.to === previous ? id : edge.to,
        }))
      : workflow.transitions,
  };
}
