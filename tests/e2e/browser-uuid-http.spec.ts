import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { z } from 'zod/mini';
const origin = 'http://192.0.2.1';
let browserScript = '';
test.beforeAll(async () => {
  const result = await build({
    entryPoints: ['tests/fixtures/browser-uuid-entry.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
  });
  const script = result.outputFiles[0];
  if (!script) throw new Error('Missing operation regression browser module');
  browserScript = script.text;
});
test('allocates secure operation UUIDs on a genuinely insecure HTTP origin and preserves exact retries', async ({
  page,
}) => {
  await page.route(`${origin}/**`, async (route) => {
    const script = new URL(route.request().url()).pathname === '/operations.js';
    await route.fulfill({
      contentType: script ? 'text/javascript' : 'text/html',
      body: script
        ? browserScript
        : '<!doctype html><html><body><script src="/operations.js"></script></body></html>',
    });
  });
  await page.goto(origin);
  expect(
    await page.evaluate(() => ({
      origin: location.origin,
      secure: isSecureContext,
      nativeUuid: typeof crypto.randomUUID,
      randomValues: typeof crypto.getRandomValues,
    })),
  ).toEqual({ origin, secure: false, nativeUuid: 'undefined', randomValues: 'function' });
  const result = z
    .object({
      operation_id: z.uuid(),
      changed_operation_id: z.uuid(),
      reused_same_proposal: z.boolean(),
      unchanged_retry_body: z.boolean(),
      unchanged_restored_body: z.boolean(),
      restored_operation_id: z.uuid(),
      envelope: z.object({
        expected_revision: z.literal(7),
        expected_config_revision: z.literal(3),
      }),
    })
    .parse(
      await page.evaluate(() => {
        const probe: unknown = Reflect.get(window, 'probeBrowserOperations');
        if (typeof probe !== 'function')
          throw new Error('Operation regression module did not load');
        return probe();
      }),
    );
  expect(result.operation_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  expect(result.changed_operation_id).not.toBe(result.operation_id);
  expect(result.restored_operation_id).toBe(result.operation_id);
  expect(result.reused_same_proposal).toBe(true);
  expect(result.unchanged_retry_body).toBe(true);
  expect(result.unchanged_restored_body).toBe(true);
});
