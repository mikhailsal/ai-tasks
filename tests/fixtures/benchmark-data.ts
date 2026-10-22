import type Database from 'better-sqlite3';
import { z } from 'zod/mini';

export type BenchmarkSize = {
  projects: number;
  tasks: number;
  occurrences: number;
  audits: number;
};

export const standardBenchmarkSize: BenchmarkSize = {
  projects: 20,
  tasks: 1_000,
  occurrences: 10_000,
  audits: 50_000,
};
export const diagnosticBenchmarkSize: BenchmarkSize = {
  projects: 20,
  tasks: 10_000,
  occurrences: 100_000,
  audits: 50_000,
};

const config = {
  priority_model: { type: 'classic' },
  ordinary_workflow: {
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
    transitions: [
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
    ].map(([from, to]) => ({
      from,
      to,
      requires_confirmation: from === 'sanity_check' && to === 'done',
    })),
  },
  recurring_workflow: {
    initial_status_id: 'draft',
    restore_status_id: 'paused',
    statuses: [
      { id: 'draft', label: 'Черновик', category: 'draft' },
      { id: 'active', label: 'Активно', category: 'active' },
      { id: 'paused', label: 'Пауза', category: 'paused' },
      { id: 'archived', label: 'Архив', category: 'archived' },
    ],
    transitions: [
      ['draft', 'active'],
      ['draft', 'archived'],
      ['active', 'paused'],
      ['active', 'archived'],
      ['paused', 'active'],
      ['paused', 'archived'],
      ['archived', 'paused'],
    ].map(([from, to]) => ({ from, to, requires_confirmation: false })),
  },
};
const model = JSON.stringify(config.priority_model);
const ordinaryWorkflow = JSON.stringify(config.ordinary_workflow);
const recurringWorkflow = JSON.stringify(config.recurring_workflow);
const snapshot = JSON.stringify(config);
const projectEmojis = [
  '😀',
  '😃',
  '😄',
  '😁',
  '😆',
  '😅',
  '😂',
  '🙂',
  '🙃',
  '😉',
  '😊',
  '😇',
  '🥰',
  '😍',
  '🤩',
  '😘',
  '😗',
  '😚',
  '😙',
  '🥲',
];

/** Deterministic domain rows; UUIDs are stable across runs, as are all timestamps. */
export function seedBenchmarkData(sqlite: Database.Database, size: BenchmarkSize) {
  const { projects: projectCount, tasks: taskCount, occurrences, audits } = size;
  for (const [name, value] of Object.entries(size))
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error(`Invalid ${name} benchmark count`);
  if (projectCount < 1 || taskCount < 1 || taskCount % projectCount !== 0)
    throw new Error('Benchmark tasks must divide evenly across projects');
  const now = 1_800_000_000_000;
  const epoch = '00000000-0000-4000-8000-000000000001';
  const taskPerProject = taskCount / projectCount;
  const recurringPerProject = Math.ceil(taskPerProject / 2);
  const recurringTaskCount = recurringPerProject * projectCount;
  if (projectCount > projectEmojis.length || occurrences % recurringTaskCount !== 0)
    throw new Error('Benchmark projects and occurrences must divide across supported dimensions');
  const occurrencePerRecurringTask = occurrences / recurringTaskCount;
  const schedule = {
    mode: 'calendar',
    pattern: 'days',
    every: 1,
    local_time: '08:00:00.000',
  };
  const scheduleJson = JSON.stringify(schedule);
  const insertProject = sqlite.prepare(
    `INSERT INTO projects(id,slug,name,description,emoji,emoji_key,priority,revision,config_revision,archived_at,created_at,updated_at)
     VALUES(?,?,?,?,?,?,0,1,1,NULL,?,?)`,
  );
  const insertConfig = sqlite.prepare(
    `INSERT INTO project_configs(project_slug,revision,priority_model,ordinary_workflow,recurring_workflow,semantic_snapshot,effective_at,actor)
     VALUES(?,1,?,?,?,?,?,'human-web')`,
  );
  const insertProjectReservation = sqlite.prepare(
    `INSERT INTO project_emoji_reservations(emoji_key,project_slug,emoji,first_reserved_at) VALUES(?,?,?,?)`,
  );
  const insertTask = sqlite.prepare(
    `INSERT INTO tasks(id,project_slug,kind,title,description,description_html,render_policy_version,emoji,emoji_key,status_id,priority,priority_scaled,deadline,revision,archived_at,created_at,updated_at)
     VALUES(?,?,?,?,?,'',1,'⚪','⚪',?,NULL,NULL,?,1,NULL,?,?)`,
  );
  const insertGeneration = sqlite.prepare(
    `INSERT INTO schedule_generations(id,task_id,project_slug,task_kind,generation_number,mode,schedule,first_deadline,timezone,miss_policy,window_ms,created_at,successor_generation_id)
     VALUES(?,?,?,'recurring',1,'calendar',?,?,'UTC','carry_forward',0,?,NULL)`,
  );
  const insertOccurrence = sqlite.prepare(
    `INSERT INTO occurrences(id,task_id,project_slug,generation_id,occurrence_key,deadline,expires_at,schedule_snapshot,miss_policy,confirmation_window_ms,description_snapshot,description_html_snapshot,render_policy_version,state,revision,actual_completed_at,completion_recorded_at,missed_at,cancelled_at,cancel_reason,created_at)
     VALUES(?,?,?,?,?,?,?,?,'carry_forward',0,'','',1,?,1,?,?,?,NULL,NULL,?)`,
  );
  const insertRecurrenceState = sqlite.prepare(
    `INSERT INTO recurrence_state(task_id,project_slug,current_generation_id,cursor_anchor,waiting_predecessor_id,next_candidate_at,revision)
     VALUES(?,?,?, ?,NULL,?,1)`,
  );
  const insertInterval = sqlite.prepare(
    `INSERT INTO recurrence_intervals(id,task_id,project_slug,start_at,end_at,behavior,schedule_generation_id)
     VALUES(?,?,?, ?,NULL,'active',?)`,
  );
  const insertAudit = sqlite.prepare(
    `INSERT INTO audit_records(id,operation_id,project_slug,entity_type,entity_id,actor,origin,timestamp,action,changes,config_snapshot,confirmation,database_epoch)
     VALUES(?,?,?,'task',?,'human-web','web',?,'benchmark.seed','[]',NULL,NULL,?)`,
  );
  sqlite.transaction(() => {
    sqlite
      .prepare(
        'UPDATE application_state SET database_epoch=?, timezone=?, revision=1, read_revision=1 WHERE id=1',
      )
      .run(epoch, 'UTC');
    for (let p = 0; p < projectCount; p += 1) {
      const slug = `project-${String(p + 1).padStart(2, '0')}`;
      const emoji = projectEmojis[p];
      if (!emoji) throw new Error('Missing deterministic project emoji');
      insertProject.run(
        uuidFrom(500_000 + p),
        slug,
        `Benchmark ${p + 1}`,
        '',
        emoji,
        emoji,
        now,
        now,
      );
      insertProjectReservation.run(emoji, slug, emoji, now);
      insertConfig.run(slug, model, ordinaryWorkflow, recurringWorkflow, snapshot, now);
      for (let local = 0; local < taskPerProject; local += 1) {
        const global = p * taskPerProject + local;
        const id = uuidFrom(global + 1);
        const recurring = local < recurringPerProject;
        const deadline = now - (global % 90) * 86_400_000;
        insertTask.run(
          id,
          slug,
          recurring ? 'recurring' : 'ordinary',
          `Task ${global + 1}`,
          '',
          recurring ? 'active' : 'idea',
          recurring ? null : deadline,
          now,
          now,
        );
        if (!recurring) continue;
        const generationId = uuidFrom(taskCount + global + 1);
        const firstDeadline = now - (occurrencePerRecurringTask - 1) * 86_400_000;
        insertGeneration.run(generationId, id, slug, scheduleJson, firstDeadline, now);
        insertRecurrenceState.run(id, slug, generationId, now, now + 86_400_000);
        insertInterval.run(
          uuidFrom(taskCount * 5 + global + 1),
          id,
          slug,
          firstDeadline,
          generationId,
        );
        for (let item = 0; item < occurrencePerRecurringTask; item += 1) {
          const occurrenceId = uuidFrom(
            taskCount * 2 + global * occurrencePerRecurringTask + item + 1,
          );
          const due = firstDeadline + item * 86_400_000;
          const state =
            item === occurrencePerRecurringTask - 1
              ? 'pending'
              : item === occurrencePerRecurringTask - 2
                ? 'debt'
                : 'completed';
          const scheduleSnapshot = JSON.stringify({
            generation_id: generationId,
            generation_number: 1,
            schedule,
            first_deadline: new Date(firstDeadline).toISOString(),
            timezone: 'UTC',
            miss_policy: 'carry_forward',
            confirmation_window_ms: 0,
          });
          const completedAt = state === 'completed' ? due : null;
          const missedAt = state === 'debt' ? due + 1 : null;
          insertOccurrence.run(
            occurrenceId,
            id,
            slug,
            generationId,
            `benchmark-${item + 1}`,
            due,
            due,
            scheduleSnapshot,
            state,
            completedAt,
            completedAt,
            missedAt,
            now,
          );
        }
      }
    }
    for (let i = 0; i < audits; i += 1) {
      const taskNumber = i % taskCount;
      const projectNumber = Math.floor(taskNumber / taskPerProject);
      insertAudit.run(
        uuidFrom(taskCount * 3 + i + 1),
        uuidFrom(taskCount * 4 + i + 1),
        `project-${String(projectNumber + 1).padStart(2, '0')}`,
        uuidFrom(taskNumber + 1),
        now + i,
        epoch,
      );
    }
  })();
  const violations = z.array(z.unknown()).parse(sqlite.pragma('foreign_key_check'));
  if (violations.length > 0) throw new Error('Seeded benchmark data violates foreign keys');
  return { ...size, epoch };
}

function uuidFrom(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
}
