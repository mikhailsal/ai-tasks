import { expect, test } from '@playwright/test';
import { completeOccurrences } from '../../src/core/recurrence/complete.js';
import { missOccurrences } from '../../src/core/recurrence/miss.js';
import { openTaskActions } from '../fixtures/task-ui.js';
import {
  browserOccurrences,
  browserRecurrenceInput,
  recurrenceBrowserServer,
  seedBrowserRecurring,
} from '../fixtures/recurrence-browser.js';

/** Spec 007 US4: a person sees the reason and the note next to the outcome, as plain text. */
test('occurrence details show the miss reason and the completion note at 430 px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 932 });
  const server = await recurrenceBrowserServer();
  try {
    const id = await seedBrowserRecurring(server, { active: true, policy: 'record_miss' });
    const [row] = browserOccurrences(server, id);
    if (!row) throw new Error('Expected a pending occurrence');
    const selection = [{ id: row.id, expected_revision: row.revision }];
    const reason = 'Он сказал нет <b>сегодня</b>';
    missOccurrences(
      server.fixture.human,
      'alpha',
      id,
      browserRecurrenceInput(server.fixture, { occurrences: selection, reason }, id),
    );
    const [missed] = browserOccurrences(server, id);
    if (!missed) throw new Error('Expected the missed occurrence');
    const note = 'Время примерное';
    completeOccurrences(
      server.fixture.human,
      'alpha',
      id,
      browserRecurrenceInput(
        server.fixture,
        { occurrences: [{ id: missed.id, expected_revision: missed.revision, note }] },
        id,
      ),
    );
    await page.goto(`${server.origin}/projects/alpha/tasks/${id}`);
    await openTaskActions(page);
    const article = page.getByRole('article', { name: `Повторение ${row.id}`, exact: true });
    await expect(article).toContainText(`Причина пропуска: ${reason}`);
    await expect(article).toContainText(`Заметка: ${note}`);
    await expect(article.locator('b')).toHaveCount(0);
  } finally {
    await page.context().close();
    await server.close();
  }
});
