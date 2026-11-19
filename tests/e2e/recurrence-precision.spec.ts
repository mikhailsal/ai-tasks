import { expect, test } from '@playwright/test';
import { openTaskActions } from '../fixtures/task-ui.js';
import { recurrenceBrowserServer, seedBrowserRecurring } from '../fixtures/recurrence-browser.js';

test('the recurrence editor shows minutes and a window unit, not milliseconds (QA F10)', async ({
  page,
}) => {
  const server = await recurrenceBrowserServer();
  try {
    // A whole-minute schedule, as a person enters it.
    const first = Math.floor(Date.now() / 60000) * 60000 + 86400000;
    const id = await seedBrowserRecurring(server, { first, active: true });
    await page.goto(`${server.origin}/projects/alpha/tasks/${id}`);
    await openTaskActions(page);
    await page.getByRole('button', { name: 'Изменить повторение', exact: true }).click();
    for (const label of ['Первое время', 'Местное время повторения'])
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(/^\d{2}:\d{2}$/u);
    await expect(page.getByLabel('Местное время повторения', { exact: true })).toHaveAttribute(
      'step',
      '60',
    );
    // Seconds stay reachable: the switch opens them (spec 001 Q10 takes milliseconds).
    await page.getByLabel('Местное время повторения: с секундами', { exact: true }).check();
    await expect(page.getByLabel('Местное время повторения', { exact: true })).toHaveAttribute(
      'step',
      '0.001',
    );
    const unit = page.getByLabel('Единица окна подтверждения', { exact: true });
    await expect(unit).not.toHaveValue('ms');
    await expect(page.getByText(/2 592 000 000|, мс/u)).toHaveCount(0);
  } finally {
    await page.context().close();
    await server.close();
  }
});
