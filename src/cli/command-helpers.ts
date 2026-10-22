import type { Command } from 'commander';
import { z } from 'zod/mini';
import { domainError } from '../core/errors.js';
import { successEnvelopeSchema, type MutationEnvelope } from '../schema/envelopes.js';
import type { JsonValue } from '../schema/values.js';
import type { createCliMutationContext, createReadContext } from './context.js';
import { mutationInput, readJsonInput, scopedInput, writeJson, type CliInput } from './io.js';
import {
  commandOptions,
  positiveIntegerOption,
  readScope,
  requireOptions,
  type CliOptions,
} from './options.js';
export const readOptions = ['json', 'project', 'allProjects', 'input'] as const;
const mutationOptions = [
  'json',
  'project',
  'allProjects',
  'input',
  'operationId',
  'databaseEpoch',
  'expectedRevision',
  'expectedConfigRevision',
  'expectedSettingsRevision',
] as const;
const queryFlags = [
  ['limit', 'limit'],
  ['cursor', 'cursor'],
  ['operation', 'operation_id'],
  ['entityId', 'entity_id'],
  ['q', 'q'],
  ['status', 'status_id'],
  ['category', 'category'],
  ['kind', 'kind'],
  ['emoji', 'emoji'],
  ['archive', 'archive'],
  ['includeTerminal', 'include_terminal'],
] as const;
export async function readCommand(command: Command, allowed: readonly (keyof CliOptions)[]) {
  const options = commandOptions(command);
  requireOptions(options, allowed);
  return { options, body: await readJsonInput(options.input) };
}
export function singleProjectInput(options: CliOptions, body: CliInput) {
  const scope = readScope(options);
  if (!('project_slug' in scope))
    throw domainError('VALIDATION_ERROR', 'This command requires --project');
  return { projectSlug: scope.project_slug, body: scopedInput(options, body) };
}
/** Preserve every JSON field so the owning read schema rejects unknown input. */
export function queryInput(options: CliOptions, body: CliInput): CliInput {
  const scope = readScope(options);
  const input = scopedInput(options, body);
  const scopeField = 'project_slug' in scope ? 'project_slug' : 'all_projects';
  const scopeValue = 'project_slug' in scope ? scope.project_slug : true;
  if (Object.hasOwn(input, scopeField)) {
    throw domainError('VALIDATION_ERROR', 'Read scope must come from command options');
  }
  input[scopeField] = scopeValue;
  for (const [option, field] of queryFlags) {
    const flag = options[option];
    if (flag === undefined) continue;
    if (Object.hasOwn(input, field))
      throw domainError('VALIDATION_ERROR', 'Query field cannot appear in both flags and JSON');
    input[field] =
      option === 'limit' && typeof flag === 'string' ? positiveIntegerOption(flag) : flag;
  }
  return input;
}
export function requireEmptyInput(body: CliInput): void {
  z.strictObject({}).parse(body);
}
function isObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function humanItem(value: JsonValue): string {
  if (!isObject(value)) return JSON.stringify(value);
  if (typeof value.id === 'string' && typeof value.title === 'string')
    return `${value.id}: ${value.title}`;
  if (typeof value.slug === 'string' && typeof value.name === 'string')
    return `${value.slug}: ${value.name}`;
  if (
    typeof value.timestamp === 'string' &&
    typeof value.action === 'string' &&
    typeof value.actor === 'string'
  )
    return `${value.timestamp} ${value.action} ${value.entity_id ?? value.id} (${value.actor})`;
  if (typeof value.revision === 'number') return `Configuration revision ${value.revision}`;
  return 'Done';
}
function humanModel(model: JsonValue | undefined): string {
  if (!model || !isObject(model)) return 'Модель не задана';
  if (model.type === 'classic') return 'Классические уровни';
  if (model.type === 'eisenhower') return 'Важность и срочность';
  if (model.type === 'named') return 'Именованные уровни';
  return `Числовая шкала: ${model.direction === 'lower' ? 'меньше — выше' : 'больше — выше'}`;
}
function humanNamedPriority(
  value: Record<string, JsonValue>,
  model: JsonValue | undefined,
): string {
  if (!model || !isObject(model) || !Array.isArray(model.levels)) return String(value.level_id);
  const level = model.levels.find((entry) => isObject(entry) && entry.id === value.level_id);
  return level && isObject(level) ? String(level.label) : String(value.level_id);
}
function humanPriority(value: JsonValue | undefined, model: JsonValue | undefined): string {
  if (!value || !isObject(value)) return 'Без приоритета';
  if (value.model === 'numeric') return String(value.value);
  if (value.model === 'eisenhower')
    return `${value.important ? 'Важно' : 'Неважно'}, ${value.urgent ? 'срочно' : 'несрочно'}`;
  if (value.model === 'named') return humanNamedPriority(value, model);
  return String(value.level);
}
function humanViewTask(value: JsonValue, model: JsonValue | undefined): string {
  if (!isObject(value)) return humanItem(value);
  const bucketLabels: Record<string, string> = {
    overdue: 'Просрочено',
    today: 'Сегодня',
    next_7_days: 'Следующие 7 дней',
    later: 'Позже',
    no_deadline: 'Без срока',
  };
  const bucket =
    typeof value.agenda_bucket === 'string' && Object.hasOwn(bucketLabels, value.agenda_bucket)
      ? `${bucketLabels[value.agenda_bucket]} · `
      : '';
  const deadline = typeof value.display_deadline === 'string' ? ` · ${value.display_deadline}` : '';
  return `${bucket}${humanItem(value)} · ${humanPriority(value.priority, model)}${deadline}`;
}
function humanCounters(value: Record<string, JsonValue>): string[] {
  const tasks = value.tasks;
  const ordinary = value.ordinary;
  const occurrences = value.occurrences;
  if (
    !tasks ||
    !ordinary ||
    !occurrences ||
    !isObject(tasks) ||
    !isObject(ordinary) ||
    !isObject(occurrences)
  )
    return [];
  const kinds: Record<string, JsonValue> =
    tasks.by_kind && isObject(tasks.by_kind) ? tasks.by_kind : {};
  return [
    `Задачи: ${tasks.total}; обычные ${kinds.ordinary ?? 0}; повторяющиеся ${kinds.recurring ?? 0}`,
    `Обычные: не завершены ${ordinary.unfinished}; просрочены ${ordinary.overdue}; завершены ${ordinary.completed}`,
    `Повторения: ожидают ${occurrences.pending}; долги ${occurrences.debt}; пропуски ${occurrences.missed}; завершены ${occurrences.completed}; поздние ${occurrences.completed_late}; отменены ${occurrences.cancelled}; всего ${occurrences.total}`,
  ];
}
function humanGroups(data: Record<string, JsonValue>): string | undefined {
  if (!Array.isArray(data.groups)) return;
  const lines = humanCounters(data);
  for (const group of data.groups) {
    if (!isObject(group) || !group.project || !isObject(group.project)) continue;
    lines.push(
      `${group.project.emoji} ${group.project.name} (${group.project.slug}) · приоритет проекта ${group.project.priority} · ${humanModel(group.priority_model)}`,
    );
    if (Array.isArray(group.items))
      lines.push(...group.items.map((task) => humanViewTask(task, group.priority_model)));
    else lines.push(...humanCounters(group));
  }
  if (typeof data.next_cursor === 'string') lines.push(`Дальше: --cursor ${data.next_cursor}`);
  return lines.join('\n') || 'Нет результатов';
}
function humanResult(data: JsonValue): string {
  if (!isObject(data)) return humanItem(data);
  if (typeof data.rendered_html === 'string') return data.rendered_html;
  const grouped = humanGroups(data);
  if (grouped !== undefined) return grouped;
  if (Array.isArray(data.items)) return data.items.map(humanItem).join('\n') || 'No results';
  if (Array.isArray(data.priority_models)) {
    const models = data.priority_models.flatMap((model) =>
      isObject(model) && typeof model.type === 'string' ? [model.type] : [],
    );
    return `Priority presets: ${models.join(', ')}`;
  }
  return humanItem(data);
}
export function writeSuccess(value: unknown, options: CliOptions): void {
  const result = successEnvelopeSchema.parse(value);
  if (options.json) writeJson(result);
  else process.stdout.write(`${humanResult(result.data)}\n`);
}
/** Mutation payload validation and all lifecycle reads remain inside executeMutation. */
export async function runMutation(
  command: Command,
  mutate: (
    context: ReturnType<typeof createCliMutationContext>,
    projectSlug: string,
    input: MutationEnvelope,
  ) => unknown,
): Promise<void> {
  const { options, body } = await readCommand(command, mutationOptions);
  const mutation = mutationInput(options, body);
  const { createCliMutationContext, withCliDatabase } = await import('./context.js');
  const result = await withCliDatabase((connection) =>
    mutate(
      createCliMutationContext(connection, mutation.projectSlug),
      mutation.projectSlug,
      mutation.input,
    ),
  );
  writeSuccess(result, options);
}
export async function runProjectRead(
  command: Command,
  read: (
    context: ReturnType<typeof createReadContext>,
    projectSlug: string,
    body: CliInput,
  ) => unknown,
  acceptsBody = false,
): Promise<void> {
  const { options, body } = await readCommand(command, readOptions);
  const input = singleProjectInput(options, body);
  if (!acceptsBody) requireEmptyInput(input.body);
  const { createReadContext, withCliDatabase } = await import('./context.js');
  const result = await withCliDatabase((connection) =>
    read(createReadContext({ connection }), input.projectSlug, input.body),
  );
  writeSuccess(result, options);
}
export function requireSubcommand(): never {
  throw domainError('VALIDATION_ERROR', 'Choose an application subcommand');
}
