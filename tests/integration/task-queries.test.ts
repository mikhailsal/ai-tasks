import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createContext } from '../../src/core/context.js';
import { openDatabase } from '../../src/core/database/open.js';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import { getTask, listTasks, isOrdinaryOverdue } from '../../src/core/queries/tasks.js';
import { renderMarkdown } from '../../src/core/markdown/render.js';
import {
  toScaledPriority,
  type PriorityModel,
  type PriorityValue,
} from '../../src/schema/configuration.js';
import { tasks } from '../../src/schema/entities.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { createDatabaseFixture, type DatabaseFixture } from '../fixtures/database.js';
import { createTestClock } from '../fixtures/clock.js';
import {
  configRow,
  generationRow,
  insertStorageRow,
  occurrenceRow,
  projectRow,
  seedTime,
} from '../fixtures/storage-seed.js';

let fixture: DatabaseFixture<ReturnType<typeof openDatabase>>;
let clock: ReturnType<typeof createTestClock>;
let context: ReturnType<typeof createContext>;
beforeEach(async () => {
  clock = createTestClock(seedTime);
  fixture = await createDatabaseFixture(
    { openDatabase, migrateDatabase, acquireDatabaseLock, releaseDatabaseLock },
    clock,
  );
  context = createContext({ connection: fixture.connection, actor: 'human-web' });
  const projects: [string, string, number, PriorityModel][] = [
    ['alpha', '🚀', 0, { type: 'classic' }],
    ['beta', '🧭', 20, { type: 'eisenhower' }],
    [
      'gamma',
      '📚',
      10,
      {
        type: 'named',
        levels: [
          { id: 'high', label: 'Первый' },
          { id: 'low', label: 'Второй' },
        ],
      },
    ],
    ['delta', '🧰', 5, { type: 'numeric', min: -100, max: 100, direction: 'higher' }],
    ['epsilon', '🧿', 5, { type: 'numeric', min: -100, max: 100, direction: 'lower' }],
    ['archived', '🛰️', 30, { type: 'classic' }],
  ];
  for (const [slug, emoji, priority, model] of projects) {
    insertStorageRow(
      fixture.connection.sqlite,
      'projects',
      projectRow({
        slug,
        emoji,
        emoji_key: emoji.replace(/\uFE0F/gu, ''),
        priority,
        archived_at: slug === 'archived' ? seedTime : null,
      }),
    );
    const config = createDefaultProjectConfig(model);
    insertStorageRow(
      fixture.connection.sqlite,
      'project_configs',
      configRow({
        project_slug: slug,
        priority_model: JSON.stringify(config.priority_model),
        ordinary_workflow: JSON.stringify(config.ordinary_workflow),
        recurring_workflow: JSON.stringify(config.recurring_workflow),
        semantic_snapshot: JSON.stringify(config),
      }),
    );
  }
});
afterEach(async () => {
  await fixture?.close();
});

function seedTask(options: {
  title: string;
  projectSlug?: string;
  description?: string;
  priority?: PriorityValue;
  deadline?: number | null;
  statusId?: string;
  archivedAt?: number | null;
  createdAt?: number;
  id?: string;
  kind?: 'ordinary' | 'recurring';
  emoji?: string;
}) {
  const id = options.id ?? randomUUID();
  const priority = options.priority ?? null;
  const description = options.description ?? '**Исходник**';
  const emoji = options.emoji ?? '⚪';
  fixture.connection.db
    .insert(tasks)
    .values({
      id,
      projectSlug: options.projectSlug ?? 'alpha',
      title: options.title,
      kind: options.kind ?? 'ordinary',
      statusId: options.statusId ?? 'idea',
      description,
      descriptionHtml: renderMarkdown(description),
      priority,
      priorityScaled: priority?.model === 'numeric' ? toScaledPriority(priority.value) : null,
      deadline: options.deadline ?? null,
      archivedAt: options.archivedAt ?? null,
      emoji,
      emojiKey: emoji.replace(/[\uFE0E\uFE0F]/gu, ''),
      createdAt: options.createdAt ?? seedTime,
      updatedAt: seedTime,
    })
    .run();
  return id;
}
function snapshot() {
  return Object.fromEntries(
    [
      'application_state',
      'projects',
      'project_configs',
      'tasks',
      'occurrences',
      'schedule_generations',
      'recurrence_state',
      'recurrence_intervals',
      'audit_records',
      'operation_receipts',
    ].map((table) => [
      table,
      fixture.connection.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
}

describe('task query SQL scope and filter isolation', () => {
  it('never lets a description match escape the explicit project scope', () => {
    const local = seedTask({ title: 'Needle local' });
    seedTask({
      title: 'Foreign',
      description: 'Needle in a foreign description',
      projectSlug: 'beta',
    });
    seedTask({ title: 'Unrelated' });
    expect(
      listTasks(context, { project_slug: 'alpha', q: 'needle' }).data.items.map((task) => task.id),
    ).toEqual([local]);
  });
  it('keeps archive-only and terminal exclusion inside the selected project scope', () => {
    const local = seedTask({ title: 'Archived local', archivedAt: seedTime });
    seedTask({ title: 'Active local' });
    seedTask({ title: 'Completed archived local', archivedAt: seedTime, statusId: 'done' });
    seedTask({ title: 'Foreign active', projectSlug: 'beta' });
    seedTask({ title: 'Foreign archived project', projectSlug: 'archived' });
    expect(
      listTasks(context, { project_slug: 'alpha', archive: 'only' }).data.items.map(
        (task) => task.id,
      ),
    ).toEqual([local]);
  });
  it('keeps unset priority filtering inside the selected project scope', () => {
    const local = seedTask({ title: 'Unset local' });
    const foreign = seedTask({ title: 'Unset foreign', projectSlug: 'beta' });
    fixture.connection.sqlite
      .prepare("UPDATE tasks SET priority = 'null' WHERE id = ?")
      .run(foreign);
    seedTask({ title: 'Prioritized local', priority: { model: 'classic', level: 'critical' } });
    expect(
      listTasks(context, {
        project_slug: 'alpha',
        priority: null,
        include_terminal: true,
      }).data.items.map((task) => task.id),
    ).toEqual([local]);
  });
});

describe('configured project-first task ordering', () => {
  it('orders assigned classic priorities before unset, then deadlines, creation time and UUID', () => {
    seedTask({ title: 'Unset', deadline: seedTime - 1000 });
    seedTask({ title: 'Low', priority: { model: 'classic', level: 'low' } });
    seedTask({ title: 'High', priority: { model: 'classic', level: 'high' } });
    seedTask({
      title: 'Critical later',
      priority: { model: 'classic', level: 'critical' },
      deadline: seedTime + 2,
    });
    seedTask({
      title: 'Critical sooner',
      priority: { model: 'classic', level: 'critical' },
      deadline: seedTime + 1,
    });
    const normal = { model: 'classic' as const, level: 'normal' as const };
    seedTask({
      title: 'Normal ID 2',
      priority: normal,
      id: '00000000-0000-4000-8000-000000000002',
    });
    seedTask({
      title: 'Normal ID 1',
      priority: normal,
      id: '00000000-0000-4000-8000-000000000001',
    });
    seedTask({ title: 'Normal earlier', priority: normal, createdAt: seedTime - 1 });
    expect(
      listTasks(context, { project_slug: 'alpha' }).data.items.map((task) => task.title),
    ).toEqual([
      'Critical sooner',
      'Critical later',
      'High',
      'Normal earlier',
      'Normal ID 1',
      'Normal ID 2',
      'Low',
      'Unset',
    ]);
  });
  it('uses Eisenhower, configured named rank and exact numeric directions within project groups', () => {
    for (const [important, urgent, title] of [
      [false, false, 'Neither'],
      [false, true, 'Urgent'],
      [true, false, 'Important'],
      [true, true, 'Both'],
    ] as const) {
      seedTask({
        projectSlug: 'beta',
        title,
        priority: { model: 'eisenhower', important, urgent },
      });
    }
    seedTask({ projectSlug: 'gamma', title: 'Named unset' });
    seedTask({
      projectSlug: 'gamma',
      title: 'Named low',
      priority: { model: 'named', level_id: 'low' },
    });
    seedTask({
      projectSlug: 'gamma',
      title: 'Named high',
      priority: { model: 'named', level_id: 'high' },
    });
    for (const projectSlug of ['delta', 'epsilon']) {
      seedTask({ projectSlug, title: 'Numeric unset' });
      seedTask({
        projectSlug,
        title: 'Numeric negative',
        priority: { model: 'numeric', value: -0.001 },
      });
      seedTask({
        projectSlug,
        title: 'Numeric positive',
        priority: { model: 'numeric', value: 0.002 },
      });
    }
    seedTask({ title: 'Classic critical', priority: { model: 'classic', level: 'critical' } });
    const titles = (project_slug: string) =>
      listTasks(context, { project_slug }).data.items.map((task) => task.title);
    expect(titles('beta')).toEqual(['Both', 'Important', 'Urgent', 'Neither']);
    expect(titles('gamma')).toEqual(['Named high', 'Named low', 'Named unset']);
    expect(titles('delta')).toEqual(['Numeric positive', 'Numeric negative', 'Numeric unset']);
    expect(titles('epsilon')).toEqual(['Numeric negative', 'Numeric positive', 'Numeric unset']);
    expect([
      ...new Set(
        listTasks(context, { all_projects: true }).data.items.map((task) => task.project_slug),
      ),
    ]).toEqual(['beta', 'gamma', 'delta', 'epsilon', 'alpha']);
  });
});

describe('strict pure task list filters and pagination', () => {
  it('applies archive/project visibility independently of terminal inclusion', () => {
    const active = seedTask({ title: 'Active' });
    const completed = seedTask({ title: 'Completed', statusId: 'done' });
    const cancelled = seedTask({ title: 'Cancelled', statusId: 'cancelled' });
    const archived = seedTask({ title: 'Archived', archivedAt: seedTime });
    const parentArchived = seedTask({ title: 'Project archived', projectSlug: 'archived' });
    const recurring = seedTask({ title: 'Draft recurring', kind: 'recurring', statusId: 'draft' });
    expect(
      listTasks(context, { all_projects: true })
        .data.items.map((task) => task.id)
        .sort(),
    ).toEqual([active, recurring].sort());
    expect(
      listTasks(context, { all_projects: true, include_terminal: true })
        .data.items.map((task) => task.id)
        .sort(),
    ).toEqual([active, recurring, completed, cancelled].sort());
    expect(
      listTasks(context, { all_projects: true, archive: 'only', include_terminal: true })
        .data.items.map((task) => task.id)
        .sort(),
    ).toEqual([archived, parentArchived].sort());
    expect(
      listTasks(context, { all_projects: true, archive: 'include', include_terminal: true }).data
        .items,
    ).toHaveLength(6);
  });
  it('uses literal Unicode-insensitive search instead of SQL wildcard matching', () => {
    const titleMatch = seedTask({ title: 'СРОЧНЫЙ заяц' });
    const descriptionMatch = seedTask({ title: 'Другой', description: 'Нужен срочный отчёт' });
    const wildcardLiteral = seedTask({ title: '100%_готово' });
    seedTask({ title: '100_DONE' });
    expect(
      listTasks(context, { project_slug: 'alpha', q: 'СрОчНыЙ' })
        .data.items.map((task) => task.id)
        .sort(),
    ).toEqual([titleMatch, descriptionMatch].sort());
    expect(
      listTasks(context, { project_slug: 'alpha', q: '%_' }).data.items.map((task) => task.id),
    ).toEqual([wildcardLiteral]);
  });
  it('filters status/category/kind, normalized emoji and complete priority values', () => {
    const planning = seedTask({
      title: 'Planning',
      statusId: 'planning',
      emoji: '✈️',
      priority: { model: 'classic', level: 'high' },
    });
    const review = seedTask({
      title: 'Review',
      statusId: 'sanity_check',
      priority: { model: 'classic', level: 'low' },
    });
    const recurring = seedTask({ title: 'Recurring', kind: 'recurring', statusId: 'draft' });
    const matrix = seedTask({
      title: 'Matrix',
      projectSlug: 'beta',
      priority: { model: 'eisenhower', important: true, urgent: false },
    });
    expect(
      listTasks(context, { project_slug: 'alpha', status_id: 'planning' }).data.items.map(
        (task) => task.id,
      ),
    ).toEqual([planning]);
    expect(
      listTasks(context, { project_slug: 'alpha', category: 'review' }).data.items.map(
        (task) => task.id,
      ),
    ).toEqual([review]);
    expect(
      listTasks(context, { project_slug: 'alpha', kind: 'recurring' }).data.items.map(
        (task) => task.id,
      ),
    ).toEqual([recurring]);
    expect(
      listTasks(context, { project_slug: 'alpha', emoji: '✈︎' }).data.items.map((task) => task.id),
    ).toEqual([planning]);
    const reorderedPriority = { urgent: false, model: 'eisenhower' as const, important: true };
    expect(
      listTasks(context, { project_slug: 'beta', priority: reorderedPriority }).data.items.map(
        (task) => task.id,
      ),
    ).toEqual([matrix]);
  });
  it('keeps page time stable, binds filters and rejects clock overrides without writes', () => {
    seedTask({ title: 'Item one' });
    seedTask({ title: 'Item two' });
    seedTask({ title: 'Item three' });
    const before = snapshot();
    const first = listTasks(context, { project_slug: 'alpha', q: 'item', limit: 1 });
    const cursor = first.data.next_cursor;
    if (cursor === null) throw new Error('Expected another task page');
    clock.advanceBy(1_000);
    const second = listTasks(context, { project_slug: 'alpha', q: 'item', limit: 1, cursor });
    expect(second.data.items[0]?.id).not.toBe(first.data.items[0]?.id);
    expect(second.meta.as_of).toBe(first.meta.as_of);
    expect(second.meta.now).toBe(new Date(clock.now()).toISOString());
    expect(() =>
      listTasks(context, { project_slug: 'alpha', q: 'other', limit: 1, cursor }),
    ).toThrow(expect.objectContaining({ code: 'CURSOR_STALE' }));
    for (const input of [
      {},
      { project_slug: 'alpha', all_projects: true as const },
      { project_slug: 'alpha', now: seedTime },
      { project_slug: 'alpha', as_of: seedTime },
    ]) {
      expect(() => listTasks(context, input)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      );
    }
    expect(snapshot()).toEqual(before);
  });
});

describe('task detail and captured effective deadlines', () => {
  it('returns raw/safe descriptions and real cross-project dependency satisfaction without writes', () => {
    const source = '  **Точный исходник**\r\n\r\n<script>alert(1)</script>  ';
    const dependent = seedTask({ title: 'Dependent', description: source });
    const completed = seedTask({
      title: 'Completed prerequisite',
      projectSlug: 'beta',
      statusId: 'done',
      archivedAt: seedTime,
    });
    const unfinished = seedTask({
      title: 'Unfinished prerequisite',
      projectSlug: 'gamma',
      statusId: 'planning',
    });
    for (const [id, projectSlug] of [
      [completed, 'beta'],
      [unfinished, 'gamma'],
    ] as const) {
      insertStorageRow(fixture.connection.sqlite, 'task_dependencies', {
        dependent_task_id: dependent,
        dependent_project_slug: 'alpha',
        prerequisite_task_id: id,
        prerequisite_project_slug: projectSlug,
        created_at: seedTime,
        created_operation_id: randomUUID(),
      });
    }
    const before = snapshot();
    const detail = getTask(context, 'alpha', dependent).data;
    expect(detail.description).toBe(source);
    expect(detail.rendered_html).toBe(renderMarkdown(source));
    expect(detail.rendered_html).not.toContain('<script>');
    expect(detail.recurrence).toBeNull();
    expect(detail.blocked).toBe(true);
    expect(detail.dependencies).toEqual([
      {
        task_id: dependent,
        prerequisite_task_id: completed,
        prerequisite_project_slug: 'beta',
        satisfied: true,
      },
      {
        task_id: dependent,
        prerequisite_task_id: unfinished,
        prerequisite_project_slug: 'gamma',
        satisfied: false,
      },
    ]);
    expect(() => getTask(context, 'beta', dependent)).toThrow(
      expect.objectContaining({ code: 'PROJECT_MISMATCH' }),
    );
    expect(snapshot()).toEqual(before);
  });
  it('shows a recurring parent once at its earliest pending/debt deadline and never ticks on read', () => {
    const parent = seedTask({ title: 'Recurring parent', kind: 'recurring', statusId: 'active' });
    const generation = randomUUID();
    insertStorageRow(
      fixture.connection.sqlite,
      'schedule_generations',
      generationRow({ id: generation, task_id: parent }),
    );
    insertStorageRow(fixture.connection.sqlite, 'recurrence_state', {
      task_id: parent,
      project_slug: 'alpha',
      current_generation_id: generation,
      revision: 1,
      cursor_anchor: null,
      next_candidate_at: seedTime,
      waiting_predecessor_id: null,
    });
    for (const [state, deadline] of [
      ['pending', seedTime + 1],
      ['debt', seedTime - 1],
      ['completed', seedTime - 10],
    ] as const) {
      insertStorageRow(
        fixture.connection.sqlite,
        'occurrences',
        occurrenceRow({
          task_id: parent,
          generation_id: generation,
          occurrence_key: `calendar:${deadline}`,
          deadline,
          expires_at: deadline,
          state,
          missed_at: state === 'debt' ? seedTime : null,
          actual_completed_at: state === 'completed' ? deadline : null,
          completion_recorded_at: state === 'completed' ? deadline : null,
        }),
      );
    }
    const before = snapshot();
    const list = listTasks(context, { project_slug: 'alpha', kind: 'recurring' });
    expect(list.data.items).toHaveLength(1);
    expect(list.data.items[0]).toMatchObject({
      deadline: null,
      display_deadline: new Date(seedTime - 1).toISOString(),
    });
    expect(getTask(context, 'alpha', parent).data.display_deadline).toBe(
      new Date(seedTime - 1).toISOString(),
    );
    expect(isOrdinaryOverdue({ category: 'in_progress', deadline: seedTime }, seedTime)).toBe(
      false,
    );
    expect(isOrdinaryOverdue({ category: 'in_progress', deadline: seedTime }, seedTime + 1)).toBe(
      true,
    );
    expect(snapshot()).toEqual(before);
  });
});
