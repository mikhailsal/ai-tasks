import { priorityValueSchema, type PriorityValue } from '../../../src/schema/configuration.js';
import { agendaInputSchema, statisticsInputSchema } from '../../../src/schema/read-views.js';

export type PriorityFilterMode =
  'any' | 'unset' | 'classic' | 'numeric' | 'eisenhower' | 'named' | 'invalid';
export type PriorityFilter = {
  mode: PriorityFilterMode;
  classic: string;
  numeric: string;
  named: string;
  important: boolean;
  urgent: boolean;
  invalid: string;
};
export type ReadFilterDraft = {
  scope: string;
  project: string;
  q: string;
  kind: string;
  status: string;
  category: string;
  emoji: string;
  archive: string;
  includeTerminal: boolean;
  limit: string;
  priority: PriorityFilter;
};
function priorityDraft(raw: string | null): PriorityFilter {
  const result: PriorityFilter = {
    mode: 'any',
    classic: 'normal',
    numeric: '',
    named: '',
    important: false,
    urgent: false,
    invalid: '',
  };
  if (raw === null) return result;
  try {
    const priority = priorityValueSchema.parse(JSON.parse(raw));
    if (priority === null) return { ...result, mode: 'unset' };
    if (priority.model === 'classic')
      return { ...result, mode: 'classic', classic: priority.level };
    if (priority.model === 'numeric')
      return { ...result, mode: 'numeric', numeric: String(priority.value) };
    if (priority.model === 'named') return { ...result, mode: 'named', named: priority.level_id };
    return {
      ...result,
      mode: 'eisenhower',
      important: priority.important,
      urgent: priority.urgent,
    };
  } catch {
    return { ...result, mode: 'invalid', invalid: raw };
  }
}
function queryScope(query: URLSearchParams): string {
  const project = query.get('project_slug');
  const all = query.get('all_projects');
  if (project !== null && all !== null) return 'invalid';
  if (project !== null) return 'project';
  return all !== null && all !== 'true' ? 'invalid' : 'all';
}
export function readFilterDraft(search: string): ReadFilterDraft {
  const query = new URLSearchParams(search);
  const project = query.get('project_slug');
  const scope = queryScope(query);
  return {
    scope,
    project: project ?? '',
    q: query.get('q') ?? '',
    kind: query.get('kind') ?? '',
    status: query.get('status_id') ?? '',
    category: query.get('category') ?? '',
    emoji: query.get('emoji') ?? '',
    archive: query.get('archive') ?? 'exclude',
    includeTerminal: query.get('include_terminal') === 'true',
    limit: query.get('limit') ?? '50',
    priority: priorityDraft(query.get('priority')),
  };
}
function selectedPriority(draft: PriorityFilter): PriorityValue | undefined {
  if (draft.mode === 'any') return undefined;
  if (draft.mode === 'unset') return null;
  if (draft.mode === 'invalid') throw new Error('Выберите допустимый фильтр приоритета.');
  let value: unknown;
  if (draft.mode === 'classic') value = { model: 'classic', level: draft.classic };
  if (draft.mode === 'named') value = { model: 'named', level_id: draft.named };
  if (draft.mode === 'numeric') {
    if (draft.numeric.trim() === '') throw new Error('Укажите числовой приоритет.');
    value = { model: 'numeric', value: Number(draft.numeric) };
  }
  if (draft.mode === 'eisenhower')
    value = { model: 'eisenhower', important: draft.important, urgent: draft.urgent };
  const parsed = priorityValueSchema.safeParse(value);
  if (!parsed.success)
    throw new Error('Проверьте приоритет: уровень, числовое значение и точность до 0,001.');
  return parsed.data;
}
function baseFilterInput(draft: ReadFilterDraft) {
  if (!['all', 'project'].includes(draft.scope))
    throw new Error('Выберите один проект или все проекты.');
  const input: Record<string, unknown> =
    draft.scope === 'project' ? { project_slug: draft.project } : { all_projects: true };
  const fields = {
    q: draft.q,
    kind: draft.kind,
    status_id: draft.status,
    category: draft.category,
    emoji: draft.emoji,
    archive: draft.archive,
  };
  for (const [key, value] of Object.entries(fields)) if (value !== '') input[key] = value;
  input.include_terminal = draft.includeTerminal;
  const priority = selectedPriority(draft.priority);
  if (priority !== undefined) input.priority = priority;
  return input;
}
function addStatisticsRange(input: Record<string, unknown>, search: string) {
  const original = new URLSearchParams(search);
  for (const bound of ['from', 'to']) {
    if (original.getAll(bound).length > 1)
      throw new Error('Дата границы повторяется в адресе. Исправьте диапазон.');
    const value = original.get(bound);
    if (value !== null) input[bound] = value;
  }
}
/** Applying is an explicit new view: drop cursor, keep statistics range, and validate before navigation. */
export function readFilterSearch(
  draft: ReadFilterDraft,
  search: string,
  statistics = false,
): string {
  const params = new URLSearchParams();
  const input = baseFilterInput(draft);
  if (statistics) {
    addStatisticsRange(input, search);
  } else {
    if (!/^[1-9]\d*$/u.test(draft.limit))
      throw new Error('Размер страницы должен быть от 1 до 200.');
    input.limit = Number(draft.limit);
  }
  const validated = statistics
    ? statisticsInputSchema.safeParse(input)
    : agendaInputSchema.safeParse(input);
  if (!validated.success)
    throw new Error('Проверьте область, фильтры, размер страницы и диапазон дат.');
  for (const [key, value] of Object.entries(validated.data))
    if (value !== undefined)
      params.set(key, key === 'priority' ? JSON.stringify(value) : String(value));
  return params.toString();
}

export function appliedReadFilters(search: string, statistics = false) {
  const query = new URLSearchParams(search);
  const archiveLabels: Record<string, string> = {
    exclude: 'Архив исключён',
    include: 'Включая архив',
    only: 'Только архив',
  };
  const archive = query.get('archive') ?? 'exclude';
  const terminal = query.get('include_terminal');
  const scope = queryScope(query);
  let visibility = statistics
    ? 'Завершённые включены всегда; отменённые исключены'
    : 'Завершённые и отменённые исключены';
  if (terminal === 'true')
    visibility = statistics
      ? 'Завершённые включены всегда; отменённые включены'
      : 'Завершённые и отменённые включены';
  if (terminal !== null && terminal !== 'true' && terminal !== 'false')
    visibility = 'Фильтр завершённых и отменённых в адресе неверен';
  return {
    scope:
      scope === 'project'
        ? `Проект: ${query.get('project_slug')}`
        : scope === 'all'
          ? 'Все проекты'
          : 'Область в адресе задана неверно',
    archive: Object.hasOwn(archiveLabels, archive)
      ? archiveLabels[archive]
      : 'Фильтр архива в адресе неверен',
    visibility,
  };
}
