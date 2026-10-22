import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { updateSettings } from '../../src/core/projects/settings.js';
import { configureRecurrence } from '../../src/core/recurrence/control.js';
import {
  createRecurring,
  dayMs,
  generationFixture,
  generationInput,
  generationSnapshot,
  rule,
  taskRevision,
} from '../fixtures/recurrence-generations.js';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';

let fixture: OrdinaryFixture | undefined;
afterEach(() => fixture?.close());

it('reports settings scope when timezone invalidates both saved schedule and parent guards, while fresh settings exposes stale parent', async () => {
  const current = await generationFixture();
  fixture = current;
  const id = createRecurring(fixture, rule(fixture.clock.now() + dayMs));
  const saved = generationInput(fixture, rule(fixture.clock.now() + 2 * dayMs), id);
  const oldRevision = taskRevision(fixture, id);
  updateSettings(fixture.human, 'alpha', generationInput(fixture, { timezone: 'Europe/Berlin' }));
  expect(taskRevision(fixture, id)).toBe(oldRevision + 1);
  const before = generationSnapshot(fixture);

  // The stored proposal is stale in two dimensions after the same timezone operation.
  // Report its changed schedule interpretation before the incidental parent revision bump.
  expect(() => configureRecurrence(current.human, 'alpha', id, saved)).toThrow(
    expect.objectContaining({
      code: 'CONFIG_CONFLICT',
      details: expect.objectContaining({ scope: 'settings' }),
    }),
  );
  expect(generationSnapshot(fixture)).toEqual(before);

  const refreshedSettings = generationInput(fixture, saved.payload, id).expected_settings_revision;
  const savedParentWithFreshSettings = {
    ...saved,
    operation_id: randomUUID(),
    ...(refreshedSettings === undefined ? {} : { expected_settings_revision: refreshedSettings }),
  };
  expect(() =>
    configureRecurrence(current.human, 'alpha', id, savedParentWithFreshSettings),
  ).toThrow(
    expect.objectContaining({
      code: 'REVISION_CONFLICT',
      details: expect.objectContaining({ scope: 'task' }),
    }),
  );
  expect(generationSnapshot(fixture)).toEqual(before);
});
