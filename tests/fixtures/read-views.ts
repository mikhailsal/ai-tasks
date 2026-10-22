import { z } from 'zod/mini';
import { createTask } from '../../src/core/tasks/commands.js';
import { transitionTask } from '../../src/core/tasks/transitions.js';
import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { createReadContext } from '../../src/core/context.js';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import { renderMarkdown, RENDER_POLICY_VERSION } from '../../src/core/markdown/render.js';
import {
  toScaledPriority,
  type PriorityModel,
  type PriorityValue,
} from '../../src/schema/configuration.js';
import { createOrdinaryFixture, ordinaryInput, type OrdinaryFixture } from './ordinary-work.js';
import {
  configRow,
  generationRow,
  insertStorageRow,
  occurrenceRow,
  projectRow,
  taskRow,
} from './storage-seed.js';
export const readViewDay = 86400000;
export type ReadViewSeedOptions = {
  asOf?: number;
  timezone?: string;
};
type TaskOptions = {
  project?: string;
  priority?: PriorityValue;
  deadline?: number | null;
  created?: number;
  id?: string;
  status?: string;
  archived?: boolean;
  description?: string;
  title?: string;
  kind?: 'ordinary' | 'recurring';
  emoji?: string;
  jsonNull?: boolean;
};
const models: [string, string, number, PriorityModel][] = [
  ['max-numeric', '🌋', 2147483647, { type: 'numeric', min: -10, max: 10, direction: 'higher' }],
  ['classic', '🧭', 10, { type: 'classic' }],
  ['alpha-eisen', '🪕', 0, { type: 'eisenhower' }],
  [
    'beta-named',
    '🧶',
    0,
    {
      type: 'named',
      levels: [
        { id: 'z_first', label: 'Первый' },
        { id: 'a_second', label: 'Второй' },
      ],
    },
  ],
  ['min-numeric', '🏔️', -2147483648, { type: 'numeric', min: -10, max: 10, direction: 'lower' }],
  ['archived', '🛟', 20, { type: 'classic' }],
];
type TaskSeeder = (meaning: string, fields?: TaskOptions) => string;
function seedRankRows(task: TaskSeeder, asOf: number) {
  for (const level of ['critical', 'high', 'normal', 'low'] as const)
    task(`rank_classic_${level}`, {
      title: `rank: ${level}`,
      priority: { model: 'classic', level },
    });
  task('rank_classic_unset', { title: 'rank: unset' });
  task('rank_classic_json_null', {
    title: 'rank: JSON null',
    jsonNull: true,
    created: asOf - 9999,
  });
  for (const [key, important, urgent] of [
    ['iu', true, true],
    ['in', true, false],
    ['nu', false, true],
    ['nn', false, false],
  ] as const)
    task(`rank_eisen_${key}`, {
      project: 'alpha-eisen',
      title: `rank: ${key}`,
      priority: { model: 'eisenhower', important, urgent },
    });
  task('rank_eisen_unset', { project: 'alpha-eisen', title: 'rank: unset' });
  for (const [key, level] of [
    ['first', 'z_first'],
    ['second', 'a_second'],
  ] as const)
    task(`rank_named_${key}`, {
      project: 'beta-named',
      title: `rank: ${key}`,
      priority: { model: 'named', level_id: level },
    });
  task('rank_named_unset', { project: 'beta-named', title: 'rank: unset' });
  for (const [direction, project, values] of [
    ['higher', 'max-numeric', [1.25, -2.5]],
    ['lower', 'min-numeric', [-2.5, 1.25]],
  ] as const) {
    task(`rank_numeric_${direction}_best`, {
      project,
      title: 'rank: best',
      priority: { model: 'numeric', value: values[0] },
    });
    task(`rank_numeric_${direction}_second`, {
      project,
      title: 'rank: second',
      priority: { model: 'numeric', value: values[1] },
    });
    task(`rank_numeric_${direction}_unset`, { project, title: 'rank: unset' });
  }
}
function seedTieRows(task: TaskSeeder, asOf: number) {
  const normal: PriorityValue = { model: 'classic', level: 'normal' };
  task('tie_deadline', { title: 'tie: deadline', priority: normal, deadline: asOf + 1 });
  task('tie_old', {
    title: 'tie: oldest',
    priority: normal,
    deadline: asOf + 2,
    created: asOf - 2 * readViewDay,
  });
  task('tie_id_late', {
    title: 'tie: UUID later',
    priority: normal,
    deadline: asOf + 2,
    id: '00000000-0000-4000-8000-000000009002',
  });
  task('tie_id_early', {
    title: 'tie: UUID earlier',
    priority: normal,
    deadline: asOf + 2,
    id: '00000000-0000-4000-8000-000000009001',
  });
  task('tie_missing', {
    title: 'tie: no deadline',
    priority: normal,
    created: asOf - 3 * readViewDay,
  });
}
/** Controlled persisted histories use real migrations and ownership constraints, without recurrence on reads. */
export function seedReadViews(fixture: OrdinaryFixture, options: ReadViewSeedOptions = {}) {
  const asOf = options.asOf ?? Date.UTC(2026, 2, 28, 22, 59, 59, 900);
  const timezone = options.timezone ?? 'Europe/Berlin';
  fixture.clock.set(asOf);
  const today = Temporal.Instant.fromEpochMilliseconds(asOf)
    .toZonedDateTimeISO(timezone)
    .toPlainDate();
  const todayEnd = today.add({ days: 1 }).toZonedDateTime(timezone).epochMilliseconds;
  const next7End = today.add({ days: 8 }).toZonedDateTime(timezone).epochMilliseconds;
  const idsByMeaning: Record<string, string> = {};
  const sqlite = fixture.connection.sqlite;
  function task(meaning: string, fields: TaskOptions = {}) {
    const id = fields.id ?? randomUUID();
    const priority = fields.priority ?? null;
    const description = fields.description ?? '**Исходник**';
    insertStorageRow(
      sqlite,
      'tasks',
      taskRow({
        id,
        project_slug: fields.project ?? 'classic',
        kind: fields.kind ?? 'ordinary',
        title: fields.title ?? meaning.replaceAll('_', ' '),
        description,
        description_html: renderMarkdown(description),
        render_policy_version: RENDER_POLICY_VERSION,
        status_id: fields.status ?? (fields.kind === 'recurring' ? 'active' : 'idea'),
        priority: fields.jsonNull ? 'null' : priority === null ? null : JSON.stringify(priority),
        priority_scaled: priority?.model === 'numeric' ? toScaledPriority(priority.value) : null,
        deadline: fields.deadline ?? null,
        created_at: fields.created ?? asOf - 10000,
        updated_at: asOf,
        archived_at: fields.archived ? asOf - 1 : null,
        emoji: fields.emoji ?? '⚪',
        emoji_key: fields.emoji ?? '⚪',
      }),
    );
    idsByMeaning[meaning] = id;
    return id;
  }
  function recurring(
    meaning: string,
    title: string,
    outcomes: {
      state: string;
      deadline: number;
    }[],
  ) {
    const id = task(meaning, { kind: 'recurring', title });
    const generation = randomUUID();
    const schedule = { mode: 'calendar', pattern: 'days', every: 1, local_time: '13:00:00.123' };
    const snapshot = {
      generation_id: generation,
      generation_number: 1,
      schedule,
      first_deadline: new Date(asOf - 10 * readViewDay).toISOString(),
      timezone,
      miss_policy: 'carry_forward',
      confirmation_window_ms: 0,
    };
    insertStorageRow(
      sqlite,
      'schedule_generations',
      generationRow({
        id: generation,
        task_id: id,
        project_slug: 'classic',
        schedule: JSON.stringify(schedule),
        timezone,
        first_deadline: asOf - 10 * readViewDay,
        created_at: asOf - 10 * readViewDay,
      }),
    );
    insertStorageRow(sqlite, 'recurrence_state', {
      task_id: id,
      project_slug: 'classic',
      current_generation_id: generation,
      cursor_anchor: null,
      next_candidate_at: asOf + readViewDay,
      waiting_predecessor_id: null,
      revision: 1,
    });
    for (const [index, outcome] of outcomes.entries()) {
      const completed = ['completed', 'completed_late'].includes(outcome.state);
      const missed = ['debt', 'missed', 'completed_late'].includes(outcome.state);
      const rowId = randomUUID();
      idsByMeaning[`${meaning}_${outcome.state}`] = rowId;
      insertStorageRow(
        sqlite,
        'occurrences',
        occurrenceRow({
          id: rowId,
          task_id: id,
          project_slug: 'classic',
          generation_id: generation,
          occurrence_key: `calendar:${outcome.deadline}:${index}`,
          deadline: outcome.deadline,
          expires_at: outcome.deadline,
          schedule_snapshot: JSON.stringify(snapshot),
          state: outcome.state,
          actual_completed_at: completed ? asOf - 100 : null,
          completion_recorded_at: completed ? asOf - 50 : null,
          missed_at: missed ? outcome.deadline : null,
          cancelled_at: outcome.state === 'cancelled' ? asOf - 20 : null,
          cancel_reason: outcome.state === 'cancelled' ? 'Причина сохранена' : null,
          created_at: asOf - 10 * readViewDay,
        }),
      );
    }
  }
  sqlite.transaction(() => {
    sqlite.prepare('UPDATE application_state SET timezone=? WHERE id=1').run(timezone);
    for (const [slug, emoji, priority, model] of models) {
      const config = createDefaultProjectConfig(model);
      config.ordinary_workflow.statuses = config.ordinary_workflow.statuses.map((status) =>
        status.id === 'in_progress' ? { ...status, label: 'Нестандартная работа' } : status,
      );
      insertStorageRow(
        sqlite,
        'projects',
        projectRow({
          slug,
          name: slug,
          emoji,
          emoji_key: emoji.replace(/\uFE0F/gu, ''),
          priority,
          archived_at: slug === 'archived' ? asOf : null,
          created_at: asOf - readViewDay,
          updated_at: asOf,
        }),
      );
      insertStorageRow(
        sqlite,
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
    seedRankRows(task, asOf);
    for (const [key, deadline] of [
      ['overdue', asOf - 1],
      ['exact', asOf],
      ['today_last', todayEnd - 1],
      ['next_start', todayEnd],
      ['next_last', next7End - 1],
      ['later', next7End],
      ['undated', null],
      ['clock_crossing', asOf + 50],
    ] as const)
      task(key, { title: `agenda: ${key}`, deadline });
    recurring('recurring_open', 'agenda: recurring open', [
      { state: 'debt', deadline: asOf - 2 },
      { state: 'pending', deadline: todayEnd },
      { state: 'completed', deadline: asOf - readViewDay },
    ]);
    recurring('recurring_empty', 'agenda: recurring empty', [
      { state: 'completed', deadline: asOf - readViewDay },
    ]);
    task('stats_unfinished', { title: 'stats: unfinished', deadline: asOf - 1 });
    task('stats_undated', { title: 'stats: undated' });
    recurring('stats_recurring', 'stats: recurring', [
      { state: 'pending', deadline: asOf + readViewDay },
      { state: 'debt', deadline: asOf - 2 * readViewDay },
      { state: 'missed', deadline: asOf - 3 * readViewDay },
      { state: 'completed', deadline: asOf - 4 * readViewDay },
      { state: 'completed_late', deadline: asOf - 5 * readViewDay },
      { state: 'cancelled', deadline: asOf - 6 * readViewDay },
    ]);
    task('higher_project_later', {
      project: 'max-numeric',
      title: 'agenda: higher project later',
      deadline: next7End,
    });
    task('search_title', { title: 'Поиск: 100%_\\ РЕГИСТР', status: 'in_progress', emoji: '🧪' });
    task('search_description', {
      title: 'Другой заголовок',
      description: '**ПоИсК**: 100%_\\ регистр',
    });
    task('search_decoy', { title: '100XY регистр' });
    task('terminal_completed', {
      title: 'visibility: completed',
      status: 'done',
      deadline: asOf - 1,
    });
    task('terminal_cancelled', { title: 'visibility: cancelled', status: 'cancelled' });
    task('task_archived', { title: 'visibility: task archived', archived: true });
    task('project_archived', { project: 'archived', title: 'visibility: project archived' });
    seedTieRows(task, asOf);
  })();
  // A real configured completion can populate T082's internal fact without depending on a future column.
  const completedAt = asOf - 50;
  fixture.clock.set(completedAt);
  try {
    const created = createTask(
      fixture.human,
      'classic',
      ordinaryInput(
        fixture,
        {
          kind: 'ordinary',
          title: 'stats: recorded completion',
          deadline: new Date(asOf + readViewDay).toISOString(),
        },
        { projectSlug: 'classic' },
      ),
    );
    const completedId = z.object({ id: z.uuid() }).parse(created.data).id;
    idsByMeaning.stats_recorded_completion = completedId;
    for (const [index, status] of [
      'planning',
      'ready',
      'in_progress',
      'sanity_check',
      'done',
    ].entries())
      transitionTask(
        fixture.human,
        'classic',
        completedId,
        ordinaryInput(
          fixture,
          {
            to_status_id: status,
            ...(status === 'done'
              ? { confirmation: { asserted: true, user_text: 'Проверено на момент завершения' } }
              : {}),
          },
          { projectSlug: 'classic', revision: index + 1 },
        ),
      );
  } finally {
    fixture.clock.set(asOf);
  }
  return {
    idsByMeaning,
    asOf,
    todayEnd,
    next7End,
    completedAt,
    projectOrder: models.filter(([slug]) => slug !== 'archived').map(([slug]) => slug),
  };
}
export function readViewsSnapshot(fixture: OrdinaryFixture) {
  return Object.fromEntries(
    [
      'application_state',
      'projects',
      'project_configs',
      'tasks',
      'task_dependencies',
      'schedule_generations',
      'recurrence_state',
      'recurrence_intervals',
      'occurrences',
      'audit_records',
      'operation_receipts',
      'project_emoji_reservations',
      'task_emoji_reservations',
    ].map((table) => [
      table,
      fixture.connection.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
}
export async function createReadViewsFixture(options: ReadViewSeedOptions = {}) {
  const fixture = await createOrdinaryFixture();
  try {
    const seeded = seedReadViews(fixture, options);
    return {
      fixture,
      readContext: createReadContext({ connection: fixture.connection, now: fixture.clock.now }),
      clock: fixture.clock,
      ...seeded,
      snapshot: () => readViewsSnapshot(fixture),
    };
  } catch (error) {
    await fixture.close();
    throw error;
  }
}
export type ReadViewsFixture = Awaited<ReturnType<typeof createReadViewsFixture>>;
