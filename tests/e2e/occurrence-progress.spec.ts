import { expect, test } from '@playwright/test';
import { occurrenceProgress } from '../../src/core/queries/progress.js';
import { completeOccurrences } from '../../src/core/recurrence/complete.js';
import { openTaskActions } from '../fixtures/task-ui.js';
import {
  browserOccurrences,
  browserRecurrenceInput,
  recurrenceBrowserServer,
  seedBrowserRecurring,
} from '../fixtures/recurrence-browser.js';

/** Spec 008 US1/US3: the web shows the occurrence day and the same progress as the CLI. */
test('the day filter and the progress block match the command output at 430 px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 932 });
  const server = await recurrenceBrowserServer();
  try {
    const id = await seedBrowserRecurring(server, { active: true, policy: 'record_miss' });
    const [row] = browserOccurrences(server, id);
    if (!row) throw new Error('Expected a pending occurrence');
    completeOccurrences(
      server.fixture.human,
      'alpha',
      id,
      browserRecurrenceInput(
        server.fixture,
        { occurrences: [{ id: row.id, expected_revision: row.revision }] },
        id,
      ),
    );
    const day = String(
      server.fixture.connection.sqlite
        .prepare('SELECT occurrence_day FROM occurrences WHERE id = ?')
        .pluck()
        .get(row.id),
    );
    const expected = occurrenceProgress(
      { connection: server.fixture.connection, now: () => server.fixture.clock.now() },
      'alpha',
      id,
      { from_day: day, to_day: day },
    ).data;
    await page.goto(`${server.origin}/projects/alpha/tasks/${id}`);
    await openTaskActions(page);
    await page.getByLabel('С дня').fill(day);
    await page.getByLabel('По день').fill(day);
    const progress = page.getByRole('region', { name: 'Прогресс' });
    await expect(progress).toContainText(`${String(expected.done)} из ${String(expected.decided)}`);
    await expect(progress).toContainText(
      `вовремя ${String(expected.breakdown.completed)} · записано после окна ${String(expected.breakdown.completed_late)}`,
    );
    const article = page.getByRole('article', { name: `Повторение ${row.id}`, exact: true });
    await expect(article).toContainText(`День: ${day}`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  } finally {
    await page.context().close();
    await server.close();
  }
});
