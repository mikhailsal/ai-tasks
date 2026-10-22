import {
  classicPriorityLabels,
  type PriorityModel,
  type PriorityValue,
} from '../../../src/schema/configuration.js';

export const categoryLabels: Readonly<Record<string, string>> = {
  not_started: 'Не начато',
  in_progress: 'В работе',
  review: 'На проверке',
  completed: 'Завершено',
  cancelled: 'Отменено',
  draft: 'Черновик',
  active: 'Активно',
  paused: 'На паузе',
  archived: 'В архиве',
};
export const agendaLabels = {
  overdue: 'Просрочено',
  today: 'Сегодня',
  next_7_days: 'Следующие 7 дней',
  later: 'Позже',
  no_deadline: 'Без срока',
};
export function modelLabel(model: PriorityModel): string {
  if (model.type === 'classic') return 'Классический';
  if (model.type === 'eisenhower') return 'Матрица важности и срочности';
  if (model.type === 'named') return 'Именованные уровни';
  return `Числовой: ${model.min}…${model.max}; ${model.direction === 'higher' ? 'больше — важнее' : 'меньше — важнее'}`;
}
export function priorityLabel(value: PriorityValue, model: PriorityModel): string {
  if (value === null) return 'Без приоритета';
  if (value.model === 'classic') return classicPriorityLabels[value.level];
  if (value.model === 'numeric') return String(value.value);
  if (value.model === 'named')
    return model.type === 'named'
      ? (model.levels.find((level) => level.id === value.level_id)?.label ??
          `Уровень ${value.level_id} больше недоступен`)
      : `Прежний уровень: ${value.level_id}`;
  if (value.important) return value.urgent ? 'Важно и срочно' : 'Важно, не срочно';
  return value.urgent ? 'Не важно, срочно' : 'Не важно и не срочно';
}
export function viewTime(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  }).format(new Date(instant));
}
