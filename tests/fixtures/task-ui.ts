import { expect, type Dialog, type Page } from '@playwright/test';

/** Explicitly authorize document navigation while testing draft recovery. */
export async function leaveWithDraft(page: Page, action: () => Promise<unknown>) {
  const approve = async (dialog: Dialog) => {
    expect(dialog.type()).toBe('beforeunload');
    await dialog.accept();
  };
  page.on('dialog', approve);
  try {
    await action();
  } finally {
    page.off('dialog', approve);
  }
}

/** Follow the same secondary action entry as a person editing a task. */
export async function openTaskActions(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Действия с задачей', exact: true });
  if (!(await dialog.isVisible()))
    await page.getByRole('button', { name: 'Действия с задачей', exact: true }).click();
  return dialog;
}

export async function closeTaskActions(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Действия с задачей', exact: true });
  if (await dialog.isVisible())
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
}

export async function openSavedDescription(page: Page) {
  const dialog = await openTaskActions(page);
  const description = dialog.locator('.task-saved-description');
  if ((await description.getAttribute('open')) === null)
    await description.getByText('Сохранённое описание', { exact: true }).click();
  return dialog.getByRole('region', { name: 'Описание задачи', exact: true });
}

export async function openTaskFormatting(page: Page) {
  const tools = page.locator('.task-description-tools');
  if ((await tools.getAttribute('open')) === null)
    await tools.getByText('Дополнительно', { exact: true }).click();
}

export async function openTaskDeadline(page: Page) {
  const summary = page.getByLabel('Изменить срок', { exact: true });
  if ((await summary.locator('..').getAttribute('open')) === null) await summary.click();
}
