import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod/mini';
import { projectConfigInputSchema } from '../../src/schema/configuration.js';
import { jsonValueSchema } from '../../src/schema/values.js';
import { createProject } from '../../src/core/projects/commands.js';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import { createTask } from '../../src/core/tasks/commands.js';
import { addDependency } from '../../src/core/tasks/dependencies.js';
import { transitionTask } from '../../src/core/tasks/transitions.js';
import { ordinaryInput } from './ordinary-work.js';
import { createRecoveryHarness } from './recovery-transport.js';
export const boardProject = { slug: 'board-review', name: 'Запуск нового продукта', emoji: '🚀' };
export const boardStages = [
  { id: 'ideas', label: 'Идеи', category: 'not_started' },
  { id: 'plan', label: 'Планирование', category: 'not_started' },
  { id: 'work', label: 'В работе', category: 'in_progress' },
  { id: 'test', label: 'Тестирование', category: 'in_progress' },
  { id: 'review', label: 'Проверка', category: 'review' },
  { id: 'done', label: 'Готово', category: 'completed' },
] as const;
export async function projectBoardServer(paged = false) {
  const ids: string[] = [];
  let neighborId = '',
    recurringId = '';
  const server = await createRecoveryHarness({
    seed(fixture) {
      const defaults = createDefaultProjectConfig();
      const config = projectConfigInputSchema.parse({
        ...defaults,
        ordinary_workflow: {
          initial_status_id: 'ideas',
          statuses: boardStages,
          transitions: boardStages.slice(1).flatMap((target, index) => {
            const source = boardStages[index];
            if (!source) throw Error('Missing configured source');
            return [
              { from: source.id, to: target.id, requires_confirmation: target.id === 'done' },
              { from: target.id, to: source.id, requires_confirmation: false },
            ];
          }),
        },
      });
      createProject(
        fixture.human,
        boardProject.slug,
        ordinaryInput(fixture, jsonValueSchema.parse({ ...boardProject, config }), {
          projectSlug: boardProject.slug,
        }),
      );
      const today = Temporal.Instant.fromEpochMilliseconds(fixture.clock.now())
        .toZonedDateTimeISO('Europe/Moscow')
        .toPlainDate();
      const deadline = (days: number) =>
        today
          .add({ days })
          .toZonedDateTime({ timeZone: 'Europe/Moscow', plainTime: '12:00' })
          .toInstant()
          .toString();
      function task(title: string, extra: Record<string, unknown> = {}) {
        return z.object({ id: z.uuid() }).parse(
          createTask(
            fixture.human,
            boardProject.slug,
            ordinaryInput(fixture, jsonValueSchema.parse({ kind: 'ordinary', title, ...extra }), {
              projectSlug: boardProject.slug,
            }),
          ).data,
        ).id;
      }
      ids.push(task('Первая задача', { priority: { model: 'classic', level: 'low' } }));
      ids.push(task('Вторая задача', { deadline: deadline(1) }));
      for (let i = 0; i < (paged ? 50 : 9); i++) ids.push(task(`Рабочая задача ${i + 1}`));
      ids.push(
        task('Найти на всех страницах', {
          description: 'Описание с уникальным словом Safari',
          priority: { model: 'classic', level: 'high' },
          deadline: deadline(0),
        }),
      );
      const dependent = ids.at(-1),
        prerequisite = ids[0];
      if (!dependent || !prerequisite) throw Error('Missing dependency fixture tasks');
      addDependency(
        fixture.human,
        boardProject.slug,
        dependent,
        ordinaryInput(
          fixture,
          { prerequisite_task_id: prerequisite, prerequisite_project_slug: boardProject.slug },
          { projectSlug: boardProject.slug, revision: 1 },
        ),
      );
      neighborId = task('Соседняя задача');
      transitionTask(
        fixture.human,
        boardProject.slug,
        neighborId,
        ordinaryInput(
          fixture,
          { to_status_id: 'plan' },
          { projectSlug: boardProject.slug, revision: 1 },
        ),
      );
      const another = task('Отдельная стадия той же категории');
      for (const [i, status] of ['plan', 'work', 'test'].entries())
        transitionTask(
          fixture.human,
          boardProject.slug,
          another,
          ordinaryInput(
            fixture,
            { to_status_id: status },
            { projectSlug: boardProject.slug, revision: i + 1 },
          ),
        );
      recurringId = z.object({ id: z.uuid() }).parse(
        createTask(fixture.human, boardProject.slug, {
          ...ordinaryInput(
            fixture,
            jsonValueSchema.parse({
              kind: 'recurring',
              title: 'Ежедневная проверка',
              recurrence: {
                first_deadline: new Date(Date.now() + 86400000).toISOString(),
                schedule: {
                  mode: 'calendar',
                  pattern: 'days',
                  every: 1,
                  local_time: '09:00:00.000',
                },
                miss_policy: 'carry_forward',
                confirmation_window_ms: 0,
              },
            }),
            { projectSlug: boardProject.slug },
          ),
          expected_settings_revision: 1,
        }).data,
      ).id;
    },
  });
  return {
    ...server,
    ids,
    neighborId,
    recurringId,
    boardPath: `/projects/${boardProject.slug}/board?kind=ordinary`,
  };
}
