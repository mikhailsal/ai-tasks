import { z } from 'zod/mini';
import { createProject } from '../../src/core/projects/commands.js';
import { createTask } from '../../src/core/tasks/commands.js';
import { ordinaryInput } from './ordinary-work.js';
import { createRecoveryHarness } from './recovery-transport.js';

export const mobileProject = { slug: 'mobile-work', name: 'Мобильные рабочие дела' };
export const mobileTitle = 'Подготовить понятную инструкцию';
export const mobileDeadline = '2026-11-01T09:30:00.000Z';
// Actual line feeds are essential: literal backslash-n strings cannot test Markdown layout.
export const mobileMarkdown = [
  '## Порядок работы',
  '',
  '- Прочитать условия',
  '- Проверить результат',
  '',
  'Использовать `готово` для отметки.',
  '',
  '```text',
  'длинная_строка_'.repeat(50),
  '```',
  '',
  ...Array.from({ length: 18 }, (_, index) => `Абзац ${index + 1}. Подробное описание работы.\n`),
].join('\n');

export async function mobileUxServer() {
  let taskId = '';
  const server = await createRecoveryHarness({
    seed(fixture) {
      createProject(
        fixture.human,
        mobileProject.slug,
        ordinaryInput(
          fixture,
          { ...mobileProject, emoji: '📱' },
          { projectSlug: mobileProject.slug },
        ),
      );
      taskId = z.object({ id: z.uuid() }).parse(
        createTask(
          fixture.human,
          mobileProject.slug,
          ordinaryInput(
            fixture,
            {
              kind: 'ordinary',
              title: mobileTitle,
              description: mobileMarkdown,
              deadline: mobileDeadline,
              priority: { model: 'classic', level: 'high' },
            },
            { projectSlug: mobileProject.slug },
          ),
        ).data,
      ).id;
    },
  });
  return { ...server, taskPath: `/projects/${mobileProject.slug}/tasks/${taskId}` };
}
