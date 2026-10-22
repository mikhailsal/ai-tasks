/// <reference lib="dom" />
import type { Page } from '@playwright/test';
import { z } from 'zod/mini';

const stateKey = '__aiTasksTestResponseLoss';
const responseSchema = z.strictObject({ status: z.int(), body: z.string(), url: z.string() });
const stateSchema = z.strictObject({ armed: z.boolean(), response: z.nullable(responseSchema) });
type LossState = z.infer<typeof stateSchema>;

/** Observe the real server response, then lose it at the browser/app boundary exactly once. */
export async function installBrowserResponseLoss(
  page: Page,
  target: { method: 'PATCH' | 'POST'; path: string },
) {
  await page.evaluate(
    ({ key, method, path }) => {
      const original = window.fetch.bind(window);
      const state: LossState = { armed: true, response: null };
      Object.defineProperty(window, key, { value: state, configurable: true });
      window.fetch = async (input, init) => {
        const address = input instanceof Request ? input.url : String(input);
        const verb = init?.method ?? (input instanceof Request ? input.method : 'GET');
        const matches =
          verb.toUpperCase() === method && new URL(address, window.location.href).pathname === path;
        if (!state.armed || !matches) return original(input, init);
        state.armed = false;
        const response = await original(input, init);
        state.response = {
          status: response.status,
          body: await response.clone().text(),
          url: response.url,
        };
        throw new TypeError('Test loss of a real completed server response');
      };
    },
    { key: stateKey, ...target },
  );
}

async function responseLossState(page: Page) {
  const value: unknown = await page.evaluate((key) => Reflect.get(window, key), stateKey);
  return stateSchema.parse(value);
}

export async function waitForBrowserResponseLoss(page: Page) {
  const observed = await page.waitForFunction((key) => {
    const state: unknown = Reflect.get(window, key);
    return (
      typeof state === 'object' && state !== null && 'response' in state && state.response !== null
    );
  }, stateKey);
  await observed.dispose();
  return responseSchema.parse((await responseLossState(page)).response);
}
