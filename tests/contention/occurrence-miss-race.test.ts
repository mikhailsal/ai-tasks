import { expect, it } from 'vitest';
import { helperCommandSchema } from '../../src/api/helper-protocol.js';
import type { JsonValue } from '../../src/schema/values.js';
import { createContentionWriters } from '../fixtures/contention-writers.js';
import {
  control,
  createRecurring,
  day,
  lifecycleFixture,
  occurrenceRows,
  recurrenceEnvelope,
} from '../fixtures/recurrence-lifecycle.js';

/** Spec 007 T015: a miss and a completion of one occurrence from two processes; one wins. */
it('miss and completion writers race; exactly one commits and the other sees a conflict', async () => {
  const fixture = await lifecycleFixture();
  let pool: Awaited<ReturnType<typeof createContentionWriters>> | undefined;
  try {
    fixture.clock.set(Date.now());
    const id = createRecurring(fixture, fixture.clock.now() + day, { policy: 'record_miss' });
    await control(fixture, id, 'active');
    const occurrence = occurrenceRows(fixture, id)[0];
    if (!occurrence) throw new Error('Expected the first obligation');
    const selection = [{ id: occurrence.id, expected_revision: occurrence.revision }];
    const command = (operation: string, payload: JsonValue) =>
      helperCommandSchema.parse({
        operation,
        scope: { project_slug: 'alpha' },
        task_id: id,
        input: recurrenceEnvelope(fixture, payload, id),
      });
    pool = await createContentionWriters(fixture, [
      command('occurrence.miss', { occurrences: selection, reason: 'сказал нет' }),
      command('occurrence.complete', { occurrences: selection }),
    ]);
    pool.release();
    const results = await pool.results;
    expect(results.filter((result) => result.envelope.ok)).toHaveLength(1);
    expect(results.find((result) => !result.envelope.ok)?.envelope).toMatchObject({
      ok: false,
      error: { code: 'REVISION_CONFLICT' },
    });
    const row = occurrenceRows(fixture, id).find((candidate) => candidate.id === occurrence.id);
    expect(['missed', 'completed']).toContain(row?.state);
  } finally {
    await pool?.close();
    await fixture.close();
  }
});
