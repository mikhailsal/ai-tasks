import { auditListInputSchema, type AuditListInput } from '../../../src/schema/audit.js';

export type AuditFilters = {
  scope: 'all' | 'project';
  project: string;
  entity: string;
  operation: string;
};
const allowed = new Set([
  'all_projects',
  'project_slug',
  'entity_id',
  'operation_id',
  'limit',
  'cursor',
]);

export function auditFilters(search: string): AuditFilters {
  const params = new URLSearchParams(search);
  return {
    scope: params.has('project_slug') ? 'project' : 'all',
    project: params.get('project_slug') ?? '',
    entity: params.get('entity_id') ?? '',
    operation: params.get('operation_id') ?? '',
  };
}

export function auditInput(search: string) {
  const params = new URLSearchParams(search);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1)
      throw new Error(
        'В адресе истории есть неизвестный или повторяющийся фильтр. Проверьте область и идентификаторы.',
      );
  }
  const all = params.get('all_projects');
  if (all !== null && all !== 'true') throw new Error('Для общей истории выберите «Все проекты».');
  const limit = params.get('limit');
  const values: Record<string, unknown> = Object.fromEntries(params);
  if (!params.has('project_slug') && all === null) values.all_projects = true;
  if (all === 'true') values.all_projects = true;
  if (limit !== null) values.limit = auditLimit(limit);
  const parsed = auditListInputSchema.safeParse(values);
  if (!parsed.success)
    throw new Error(
      'Укажите одну область истории, корректный slug и полные UUID сущности и операции. Размер страницы — от 1 до 200.',
    );
  return parsed.data;
}

function auditLimit(value: string): number {
  if (!/^\d+$/u.test(value))
    throw new Error('Размер страницы должен быть целым числом от 1 до 200.');
  return Number(value);
}

export function auditPath(input: AuditListInput): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input))
    if (value !== undefined) params.set(key, String(value));
  return `/audit?${params.toString()}`;
}

export function auditFilterHref(filters: AuditFilters): string {
  const parsed = auditListInputSchema.safeParse({
    ...(filters.scope === 'project' ? { project_slug: filters.project } : { all_projects: true }),
    ...(filters.entity ? { entity_id: filters.entity } : {}),
    ...(filters.operation ? { operation_id: filters.operation } : {}),
  });
  if (!parsed.success) throw new Error('Проверьте slug проекта и UUID сущности и операции.');
  return auditPath(parsed.data);
}

export function auditPageHref(search: string, cursor?: string): string {
  const params = new URLSearchParams(search);
  params.delete('cursor');
  if (cursor !== undefined) params.set('cursor', cursor);
  return `/audit?${params.toString()}`;
}
