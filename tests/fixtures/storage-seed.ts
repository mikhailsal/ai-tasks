import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

type StorageValue = string | number | null;
type StorageRow = Record<string, StorageValue>;

// Table/column identifiers come only from authored test fixtures, never caller input.
export function insertStorageRow(sqlite: Database.Database, table: string, row: StorageRow): void {
  const columns = Object.keys(row);
  const sql = `INSERT INTO "${table}" (${columns.map((key) => `"${key}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
  sqlite.prepare(sql).run(...Object.values(row));
}

export const seedTime = Date.UTC(2026, 0, 1);

export function projectRow(overrides: StorageRow = {}): StorageRow {
  return {
    id: randomUUID(),
    slug: 'alpha',
    name: 'Alpha',
    description: '',
    emoji: '🚀',
    emoji_key: '🚀',
    priority: 0,
    revision: 1,
    config_revision: 1,
    archived_at: null,
    created_at: seedTime,
    updated_at: seedTime,
    ...overrides,
  };
}

export function configRow(overrides: StorageRow = {}): StorageRow {
  const ordinary = {
    initial_status_id: 'idea',
    statuses: [{ id: 'idea', label: 'Идея', category: 'not_started' }],
    transitions: [],
  };
  const recurring = {
    initial_status_id: 'draft',
    restore_status_id: 'paused',
    statuses: [
      { id: 'draft', label: 'Черновик', category: 'draft' },
      { id: 'paused', label: 'Пауза', category: 'paused' },
    ],
    transitions: [],
  };
  return {
    project_slug: 'alpha',
    revision: 1,
    priority_model: '{"type":"classic"}',
    ordinary_workflow: JSON.stringify(ordinary),
    recurring_workflow: JSON.stringify(recurring),
    semantic_snapshot: JSON.stringify({
      priority_model: { type: 'classic' },
      ordinary_workflow: ordinary,
      recurring_workflow: recurring,
    }),
    effective_at: seedTime,
    actor: 'human-web',
    ...overrides,
  };
}

export function taskRow(overrides: StorageRow = {}): StorageRow {
  return {
    id: randomUUID(),
    project_slug: 'alpha',
    kind: 'ordinary',
    title: 'Задача',
    description: '**Исходник**',
    description_html: '<p><strong>Исходник</strong></p>',
    render_policy_version: 1,
    emoji: '⚪',
    emoji_key: '⚪',
    status_id: 'idea',
    priority: null,
    priority_scaled: null,
    deadline: null,
    revision: 1,
    archived_at: null,
    created_at: seedTime,
    updated_at: seedTime,
    ...overrides,
  };
}

export function auditRow(overrides: StorageRow = {}): StorageRow {
  return {
    id: randomUUID(),
    operation_id: randomUUID(),
    project_slug: 'absent-project',
    entity_type: 'task',
    entity_id: randomUUID(),
    actor: 'human-web',
    origin: 'web',
    timestamp: seedTime,
    action: 'task.create',
    changes: '[{"field":"title","before":null,"after":"Старая задача"}]',
    config_snapshot: '{"revision":1,"status":{"id":"idea","label":"Старое имя"}}',
    confirmation: '{"asserted":true,"user_text":"Подтверждаю"}',
    database_epoch: randomUUID(),
    ...overrides,
  };
}

export function receiptRow(overrides: StorageRow = {}): StorageRow {
  return {
    database_epoch: randomUUID(),
    operation_id: randomUUID(),
    request_hash: 'a'.repeat(64),
    actor: 'human-web',
    project_slug: 'absent-project',
    operation: 'task.create',
    result: '{"data":{"title":"Старая задача"},"revision":1}',
    audit_ids: '[]',
    committed_at: seedTime,
    ...overrides,
  };
}

export function seedProject(sqlite: Database.Database, slug = 'alpha'): void {
  sqlite.transaction(() => {
    const emoji = slug === 'alpha' ? '🚀' : '🧭';
    insertStorageRow(sqlite, 'projects', projectRow({ slug, emoji, emoji_key: emoji }));
    insertStorageRow(sqlite, 'project_configs', configRow({ project_slug: slug }));
  })();
}

export function generationRow(overrides: StorageRow = {}): StorageRow {
  return {
    id: randomUUID(),
    task_id: randomUUID(),
    project_slug: 'alpha',
    generation_number: 1,
    mode: 'calendar',
    schedule: '{"mode":"calendar","pattern":"days","every":1,"local_time":"00:00:00.000"}',
    first_deadline: seedTime,
    timezone: 'Europe/Moscow',
    miss_policy: 'carry_forward',
    window_ms: 0,
    created_at: seedTime,
    successor_generation_id: null,
    ...overrides,
  };
}

export function occurrenceRow(overrides: StorageRow = {}): StorageRow {
  return {
    id: randomUUID(),
    task_id: randomUUID(),
    project_slug: 'alpha',
    generation_id: randomUUID(),
    occurrence_key: `calendar:${seedTime}`,
    deadline: seedTime,
    expires_at: seedTime,
    schedule_snapshot: '{"mode":"calendar","pattern":"days","every":1,"local_time":"00:00:00.000"}',
    miss_policy: 'carry_forward',
    confirmation_window_ms: 0,
    description_snapshot: '**Исходник**',
    description_html_snapshot: '<p><strong>Исходник</strong></p>',
    render_policy_version: 1,
    state: 'pending',
    revision: 1,
    actual_completed_at: null,
    completion_recorded_at: null,
    missed_at: null,
    cancelled_at: null,
    cancel_reason: null,
    created_at: seedTime,
    ...overrides,
  };
}
