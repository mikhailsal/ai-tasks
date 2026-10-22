import { afterEach, beforeEach, expect, it } from 'vitest';
import { configureRecurrence, controlRecurrence } from '../../src/core/recurrence/control.js';
import { completeOccurrences } from '../../src/core/recurrence/complete.js';
import { cancelOccurrences } from '../../src/core/recurrence/cancel.js';
import { updateSettings } from '../../src/core/projects/settings.js';
import {
  createRecurring,
  dayMs,
  generationFixture,
  generationInput,
  generations,
  occurrences,
  rule,
} from '../fixtures/recurrence-generations.js';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';

let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());

it.each(['pending', 'completed', 'cancelled'] as const)(
  'timezone continuation follows the furthest materialized %s historical deadline after an earlier active restart',
  (outcome) => {
    const farDeadline = fixture.clock.now() + 10 * dayMs;
    const id = createRecurring(fixture, rule(farDeadline));
    controlRecurrence(
      fixture.human,
      'alpha',
      id,
      generationInput(fixture, { to_status_id: 'active' }, id),
    );
    const original = occurrences(fixture, id).find((row) => row.deadline === farDeadline);
    if (!original) throw new Error('Missing production precreated occurrence');
    const selected = { occurrences: [{ id: original.id, expected_revision: original.revision }] };
    if (outcome === 'completed')
      completeOccurrences(fixture.human, 'alpha', id, generationInput(fixture, selected, id));
    if (outcome === 'cancelled') {
      controlRecurrence(
        fixture.human,
        'alpha',
        id,
        generationInput(fixture, { to_status_id: 'paused' }, id),
      );
      cancelOccurrences(
        fixture.human,
        'alpha',
        id,
        generationInput(fixture, { ...selected, reason: 'Явно отменённый будущий период' }, id),
      );
      controlRecurrence(
        fixture.human,
        'alpha',
        id,
        generationInput(fixture, { to_status_id: 'active' }, id),
      );
    }
    const historical = occurrences(fixture, id).find((row) => row.id === original.id);
    expect(historical?.state).toBe(outcome);
    const earlierRestart = fixture.clock.now() + dayMs;
    configureRecurrence(
      fixture.human,
      'alpha',
      id,
      generationInput(fixture, rule(earlierRestart), id),
    );
    expect(occurrences(fixture, id)).toContainEqual(
      expect.objectContaining({ deadline: earlierRestart, state: 'pending' }),
    );
    updateSettings(fixture.human, 'alpha', generationInput(fixture, { timezone: 'UTC' }));
    const latest = generations(fixture, id).at(-1);
    expect(latest).toMatchObject({ generation_number: 3, timezone: 'UTC' });
    const continued = occurrences(fixture, id).filter((row) => row.generation_id === latest?.id);
    expect(continued).toHaveLength(1);
    expect(continued[0]?.deadline).toBeGreaterThan(farDeadline);
    expect(continued[0]).toMatchObject({
      state: 'pending',
      actual_completed_at: null,
      completion_recorded_at: null,
    });
    expect(occurrences(fixture, id).find((row) => row.id === original.id)).toEqual(historical);
  },
);
