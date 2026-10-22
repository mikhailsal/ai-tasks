import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod/mini';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';
import {
  control,
  createRecurring,
  day,
  lifecycleFixture,
  occurrenceRows,
  tick,
} from '../fixtures/recurrence-lifecycle.js';
const checkpointSchema = z.object({
  cursor_anchor: z.nullable(z.number()),
  next_candidate_at: z.nullable(z.number()),
  revision: z.int().check(z.positive()),
});
/** Share one real history across bounded cases without changing the per-case or suite budgets. */
describe(
  '1200-day active downtime catches up through bounded committed waves',
  { concurrent: false, shuffle: false },
  () => {
    let fixture: OrdinaryFixture;
    let id: string;
    let first: number;
    let now: number;
    let completedWaves = 0;
    let previousCount = 0;
    let previousCheckpoint: z.infer<typeof checkpointSchema>;
    function checkpoint() {
      return checkpointSchema.parse(
        fixture.connection.sqlite.prepare('SELECT * FROM recurrence_state WHERE task_id=?').get(id),
      );
    }
    beforeAll(async () => {
      fixture = await lifecycleFixture();
      first = fixture.clock.now();
      id = createRecurring(fixture, first);
      await control(fixture, id, 'active');
      fixture.clock.advanceBy(1200 * day);
      now = fixture.clock.now();
      previousCount = occurrenceRows(fixture, id).length;
      previousCheckpoint = checkpoint();
    });
    afterAll(async () => {
      await fixture?.close();
    });
    it.each([0, 1, 2, 3, 4])(
      'commits wave %i using at most two ticks without skipped or duplicate anchors',
      async (wave) => {
        // A later wave cannot conceal an earlier failed wave or independently restart the history.
        expect(completedWaves).toBe(wave);
        expect(occurrenceRows(fixture, id)).toHaveLength(previousCount);
        expect(checkpoint()).toEqual(previousCheckpoint);
        let rows = occurrenceRows(fixture, id);
        expect(rows.some((row) => row.deadline > now)).toBe(false);
        const startCount = rows.length;
        for (let pass = 0; pass < 2 && !rows.some((row) => row.deadline > now); pass++) {
          const previous = rows.length;
          await tick(fixture, [id]);
          rows = occurrenceRows(fixture, id);
          expect(rows.length).toBeGreaterThan(previous);
          expect(rows.length - previous).toBeLessThanOrEqual(128);
        }
        expect(rows.length - startCount).toBeLessThanOrEqual(256);
        expect(rows.map((row) => row.deadline)).toEqual(
          Array.from({ length: rows.length }, (_, index) => first + index * day),
        );
        expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
        expect(
          rows.filter((row) => row.deadline < now).every((row) => row.state === 'missed'),
        ).toBe(true);
        const currentCheckpoint = checkpoint();
        expect(currentCheckpoint.cursor_anchor).toBe(rows.at(-1)?.deadline);
        expect(currentCheckpoint.next_candidate_at).toBe(first + rows.length * day);
        expect(currentCheckpoint.revision).toBeGreaterThan(previousCheckpoint.revision);
        previousCount = rows.length;
        previousCheckpoint = currentCheckpoint;
        completedWaves++;
      },
    );
    it('preserves all 1202 exact anchors and repeating the final tick creates no extra occurrence or parent', async () => {
      expect(completedWaves).toBe(5);
      const rows = occurrenceRows(fixture, id);
      expect(rows.map((row) => row.deadline)).toEqual(
        Array.from({ length: 1202 }, (_, index) => first + index * day),
      );
      expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
      expect(rows.filter((row) => row.deadline < now).every((row) => row.state === 'missed')).toBe(
        true,
      );
      await tick(fixture, [id]);
      expect(occurrenceRows(fixture, id)).toEqual(rows);
      expect(checkpoint()).toEqual(previousCheckpoint);
      expect(
        fixture.connection.sqlite
          .prepare("SELECT count(*) FROM tasks WHERE kind='recurring'")
          .pluck()
          .get(),
      ).toBe(1);
    });
  },
);
