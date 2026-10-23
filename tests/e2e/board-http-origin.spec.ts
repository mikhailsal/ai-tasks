import { expect, test, type BrowserContext } from '@playwright/test';
import { z } from 'zod/mini';
import { boardProject, projectBoardServer } from '../fixtures/project-board.js';
const insecureOrigin = 'http://192.0.2.2';
/** Preserve the real app/assets/API and mutation bytes behind a plain HTTP browser origin. */
async function proxyApplication(context: BrowserContext, upstreamOrigin: string) {
  await context.route(`${insecureOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers: Record<string, string> = { ...request.headers(), origin: upstreamOrigin };
    // Host is routing metadata and must be derived from the real upstream URL.
    delete headers.host;
    const upstream = await route.fetch({
      url: `${upstreamOrigin}${url.pathname}${url.search}`,
      headers,
    });
    await route.fulfill({ response: upstream });
  });
}

test('a real app drag on insecure HTTP commits shared order and survives a fresh browser context', async ({
  page,
  browser,
}) => {
  const server = await projectBoardServer();
  let fresh: BrowserContext | undefined;
  try {
    await proxyApplication(page.context(), server.origin);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${insecureOrigin}${server.boardPath}`);
    expect(
      await page.evaluate(() => ({
        origin: location.origin,
        secure: isSecureContext,
        nativeUuid: typeof crypto.randomUUID,
        randomValues: typeof crypto.getRandomValues,
      })),
    ).toEqual({
      origin: insecureOrigin,
      secure: false,
      nativeUuid: 'undefined',
      randomValues: 'function',
    });
    const source = page.locator('.board-column[data-status-id="ideas"]');
    const cards = source.locator('.board-task');
    await expect(cards).toHaveCount(server.ids.length);
    const firstId = server.ids[0],
      secondId = server.ids[1];
    if (!firstId || !secondId) throw new Error('Missing fixture cards');
    await expect(cards.first().locator('.board-drag-handle')).toBeEnabled();
    const handle = await cards.first().locator('.board-drag-handle').boundingBox();
    const second = await cards.nth(1).boundingBox();
    if (!handle || !second) throw new Error('Missing drag geometry');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.move(second.x + second.width / 2, second.y + second.height - 3, { steps: 12 });
    const committed = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/position'),
    );
    await page.mouse.up();
    const response = await committed;
    expect(response.status()).toBe(200);
    const result = z
      .object({
        ok: z.literal(true),
        meta: z.object({ operation_id: z.uuid(), audit_ids: z.array(z.uuid()) }),
      })
      .parse(await response.json());
    expect(result.meta.operation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    await expect(cards.nth(0)).toHaveAttribute('data-task-id', secondId);
    await expect(cards.nth(1)).toHaveAttribute('data-task-id', firstId);
    const expected = [secondId, firstId, ...server.ids.slice(2)];
    const stored = server.inspect((sqlite) =>
      z
        .array(z.object({ task_id: z.uuid() }))
        .parse(
          sqlite
            .prepare(
              'SELECT task_id FROM board_order WHERE project_slug=? AND kind=? AND status_id=? ORDER BY position,task_id',
            )
            .all(boardProject.slug, 'ordinary', 'ideas'),
        ),
    );
    expect(stored.map((row) => row.task_id)).toEqual(expected);
    expect(
      server.inspect((sqlite) =>
        sqlite
          .prepare('SELECT count(*) FROM operation_receipts WHERE operation_id=?')
          .pluck()
          .get(result.meta.operation_id),
      ),
    ).toBe(1);
    fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await proxyApplication(fresh, server.origin);
    const other = await fresh.newPage();
    await other.goto(`${insecureOrigin}${server.boardPath}`);
    expect(await other.evaluate(() => isSecureContext)).toBe(false);
    const freshCards = other.locator('.board-column[data-status-id="ideas"] .board-task');
    await expect(freshCards).toHaveCount(server.ids.length);
    await expect(freshCards.nth(0)).toHaveAttribute('data-task-id', secondId);
    await expect(freshCards.nth(1)).toHaveAttribute('data-task-id', firstId);
  } finally {
    await fresh?.close();
    await page.context().close();
    await server.close();
  }
});
