import { afterEach, describe, expect, it } from 'vitest';
import { createContext } from '../../src/core/context.js';
import { createMutationFixture, type MutationFixture } from '../fixtures/mutation-seed.js';

const fixtures: MutationFixture[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});
async function fixture() {
  const value = await createMutationFixture();
  fixtures.push(value);
  return value;
}

describe('injected application context', () => {
  it('preserves the connection and reads its injected clock for normal web and CLI callers', async () => {
    const { connection, clock } = await fixture();
    const web = createContext({ connection, actor: 'human-web' });
    const cli = createContext({ connection, actor: 'ai-cli:alpha' });
    expect(web.connection).toBe(connection);
    expect(web.origin).toBe('web');
    expect(cli.origin).toBe('cli');
    expect(web.now()).toBe(clock.now());
    clock.advanceBy(1000);
    expect(web.now()).toBe(clock.now());
    expect(cli.now()).toBe(clock.now());
  });

  it('accepts an explicit clock and worker origin only for a valid project CLI actor', async () => {
    const { connection } = await fixture();
    const worker = createContext({
      connection,
      actor: 'ai-cli:alpha',
      origin: 'recurrence-worker',
      now: () => 0,
    });
    expect(worker.origin).toBe('recurrence-worker');
    expect(worker.now()).toBe(0);
    expect(() =>
      createContext({ connection, actor: 'human-web', origin: 'recurrence-worker' }),
    ).toThrow();
    for (const actor of [
      'ai-cli:',
      'ai-cli:Alpha',
      'ai-cli:alpha--beta',
      `ai-cli:${'a'.repeat(65)}`,
    ] as const) {
      expect(() => createContext({ connection, actor })).toThrow();
    }
  });

  it('rejects invalid injected time on each read without caching the clock', async () => {
    const { connection } = await fixture();
    let instant = 100;
    const context = createContext({ connection, actor: 'human-web', now: () => instant });
    expect(context.now()).toBe(100);
    instant = 0.5;
    expect(() => context.now()).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
});
