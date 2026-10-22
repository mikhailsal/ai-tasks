import { expect, it } from 'vitest';
import { setTimeout as until } from 'node:timers/promises';
import { z } from 'zod/mini';
import { helperCommandSchema } from '../../src/api/helper-protocol.js';
import {
  mutationEnvelopeSchema,
  mutationSuccessEnvelopeSchema,
} from '../../src/schema/envelopes.js';
import { createContentionWriters } from '../fixtures/contention-writers.js';
import {
  control,
  createRecurring,
  day,
  lifecycleFixture,
  occurrenceRows,
  parentRow,
  recurrenceApi,
  recurrenceEnvelope,
} from '../fixtures/recurrence-lifecycle.js';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';
function tickCommand(fixture: OrdinaryFixture, id: string) {
  return helperCommandSchema.parse({
    operation: 'recurrence.tick',
    scope: { project_slug: 'alpha' },
    input: recurrenceEnvelope(fixture, {
      tasks: [{ task_id: id, expected_revision: parentRow(fixture, id).revision }],
    }),
  });
}
function rowAudits(fixture: OrdinaryFixture, id: string, action: string) {
  return fixture.connection.sqlite
    .prepare('SELECT id FROM audit_records WHERE entity_id=? AND action=?')
    .all(id, action);
}
function receipts(fixture: OrdinaryFixture, operations: string[]) {
  return z
    .array(z.object({ operation_id: z.string() }))
    .parse(fixture.connection.sqlite.prepare('SELECT operation_id FROM operation_receipts').all())
    .filter((row) => operations.includes(row.operation_id));
}
// The real helper protocol gains these commands at T074. Until then a missing union
// member is a setup prerequisite, explicitly not a behavioral RED for this suite.
it.each(['same-operation', 'different-operations'] as const)(
  'independent tick writers (%s) serialize parent revisions and never duplicate owed keys, misses, or receipts',
  async (identity) => {
    const fixture = await lifecycleFixture();
    let pool: Awaited<ReturnType<typeof createContentionWriters>> | undefined;
    try {
      fixture.clock.set(Date.now());
      const calendarAnchor = new Date(fixture.clock.now());
      calendarAnchor.setUTCHours(10, 0, 0, 123);
      const mostRecent =
        calendarAnchor.getTime() > fixture.clock.now()
          ? calendarAnchor.getTime() - day
          : calendarAnchor.getTime();
      const first = mostRecent - 5 * day;
      fixture.clock.set(first);
      const id = createRecurring(fixture, first);
      await control(fixture, id, 'active');
      fixture.clock.set(Date.now());
      const left = tickCommand(fixture, id);
      const right = identity === 'same-operation' ? left : tickCommand(fixture, id);
      if (!('input' in left) || !('input' in right))
        throw new Error('Tick requires mutation input');
      const operations = [
        mutationEnvelopeSchema.parse(left.input).operation_id,
        mutationEnvelopeSchema.parse(right.input).operation_id,
      ];
      pool = await createContentionWriters(fixture, [left, right]);
      expect(new Set(pool.workers).size).toBe(2);
      expect(new Set(pool.helpers).size).toBe(2);
      pool.release();
      const results = await pool.results;
      const successful = results.filter((result) => result.envelope.ok);
      expect(successful).toHaveLength(identity === 'same-operation' ? 2 : 1);
      const winner = successful[0];
      if (!winner) throw new Error('Missing successful real tick');
      const success = mutationSuccessEnvelopeSchema.parse(winner.envelope);
      if (identity === 'same-operation') expect(results[0]?.envelope).toEqual(results[1]?.envelope);
      else
        expect(results.find((result) => !result.envelope.ok)?.envelope).toMatchObject({
          ok: false,
          error: { code: 'REVISION_CONFLICT' },
        });
      const rows = occurrenceRows(fixture, id);
      expect(rows.map((row) => row.deadline)).toEqual(
        Array.from({ length: 7 }, (_, index) => first + index * day),
      );
      expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
      expect(
        fixture.connection.sqlite
          .prepare(
            'SELECT count(*) FROM (SELECT generation_id,occurrence_key FROM occurrences GROUP BY generation_id,occurrence_key HAVING count(*)>1)',
          )
          .pluck()
          .get(),
      ).toBe(0);
      for (const row of rows.filter((row) => row.deadline < Date.now()))
        expect(rowAudits(fixture, row.id, 'occurrence.miss')).toHaveLength(1);
      expect(receipts(fixture, operations)).toEqual([{ operation_id: success.meta.operation_id }]);
      const auditIds = z
        .array(z.object({ id: z.string() }))
        .parse(
          fixture.connection.sqlite
            .prepare('SELECT id FROM audit_records WHERE operation_id=?')
            .all(success.meta.operation_id),
        )
        .map((row) => row.id);
      expect(auditIds.sort()).toEqual([...success.meta.audit_ids].sort());
      expect(
        fixture.connection.sqlite
          .prepare('SELECT DISTINCT actor,origin FROM audit_records WHERE operation_id=?')
          .all(success.meta.operation_id),
      ).toEqual([{ actor: 'human-web', origin: 'web' }]);
    } finally {
      await pool?.close();
      await fixture.close();
    }
  },
);
it('actual expiry and completion writers obey recording-time timeliness, retain one miss, and close only the selected obligation', async () => {
  const fixture = await lifecycleFixture();
  let pool: Awaited<ReturnType<typeof createContentionWriters>> | undefined;
  try {
    fixture.clock.set(Date.now());
    const deadline = fixture.clock.now() + 1500;
    const id = createRecurring(fixture, deadline, { elapsed: true, policy: 'carry_forward' });
    await control(fixture, id, 'active');
    const occurrence = occurrenceRows(fixture, id)[0];
    if (!occurrence) throw new Error('Expected the explicit first obligation');
    expect(occurrence.state).toBe('pending');
    const expiry = tickCommand(fixture, id);
    const completion = helperCommandSchema.parse({
      operation: 'occurrence.complete',
      scope: { project_slug: 'alpha' },
      task_id: id,
      input: recurrenceEnvelope(
        fixture,
        { occurrences: [{ id: occurrence.id, expected_revision: occurrence.revision }] },
        id,
      ),
    });
    if (!('input' in expiry) || !('input' in completion))
      throw new Error('Missing mutation envelopes');
    const operations = [
      mutationEnvelopeSchema.parse(expiry.input).operation_id,
      mutationEnvelopeSchema.parse(completion.input).operation_id,
    ];
    pool = await createContentionWriters(fixture, [expiry, completion]);
    expect(new Set(pool.workers).size).toBe(2);
    expect(new Set(pool.helpers).size).toBe(2);
    // Wait for the actual captured endpoint, not an arbitrary scheduling delay.
    while (Date.now() <= deadline) await until(Math.max(1, deadline - Date.now() + 1));
    pool.release();
    const results = await pool.results;
    expect(results.filter((result) => result.envelope.ok)).toHaveLength(1);
    expect(results.find((result) => !result.envelope.ok)?.envelope).toMatchObject({
      ok: false,
      error: { code: 'REVISION_CONFLICT' },
    });
    const committed = mutationSuccessEnvelopeSchema.parse(
      results.find((result) => result.envelope.ok)?.envelope,
    );
    expect(receipts(fixture, operations)).toEqual([{ operation_id: committed.meta.operation_id }]);
    let row = occurrenceRows(fixture, id).find((candidate) => candidate.id === occurrence.id);
    if (!row) throw new Error('Lost the raced obligation');
    if (row.state === 'debt') {
      // The expiry winner makes the stale completion fail; an explicit fresh retry
      // closes that exact debt and preserves the original logical miss.
      fixture.clock.set(Date.now());
      const api = await recurrenceApi();
      api.completeOccurrences(
        fixture.human,
        'alpha',
        id,
        recurrenceEnvelope(
          fixture,
          { occurrences: [{ id: row.id, expected_revision: row.revision }] },
          id,
        ),
      );
      row = occurrenceRows(fixture, id).find((candidate) => candidate.id === occurrence.id);
    }
    expect(row).toMatchObject({
      state: 'completed_late',
      missed_at: deadline,
      deadline,
      expires_at: deadline,
    });
    expect(row?.completion_recorded_at).toBeGreaterThan(deadline);
    expect(row?.actual_completed_at).toBe(row?.completion_recorded_at);
    expect(rowAudits(fixture, occurrence.id, 'occurrence.miss')).toHaveLength(1);
    expect(rowAudits(fixture, occurrence.id, 'occurrence.complete')).toHaveLength(1);
    const rows = occurrenceRows(fixture, id);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      state: 'pending',
      deadline: (row?.actual_completed_at ?? 0) + day,
      actual_completed_at: null,
    });
    expect(
      fixture.connection.sqlite
        .prepare('SELECT count(*) FROM occurrences WHERE generation_id=? AND occurrence_key=?')
        .pluck()
        .get(occurrence.generation_id, `after:${occurrence.id}`),
    ).toBe(1);
    expect(
      fixture.connection.sqlite
        .prepare('SELECT DISTINCT actual_completed_at FROM occurrences WHERE id!=?')
        .pluck()
        .all(occurrence.id),
    ).toEqual([null]);
  } finally {
    await pool?.close();
    await fixture.close();
  }
});
