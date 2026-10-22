import { expect, it } from 'vitest';
import { z } from 'zod/mini';

const conflictSchema = z.strictObject({
  reason: z.enum([
    'reservation_owner_mismatch',
    'project_marker_collision',
    'task_marker_collision',
  ]),
  emoji_key: z.string(),
  reservation_project_slug: z.string(),
  conflicting_project_slug: z.string(),
  entity_id: z.nullable(z.string()),
});
type Conflict = z.output<typeof conflictSchema>;
async function sorter() {
  const modulePath = '../../src/core/recovery/reservations.js';
  const loaded: unknown = await import(modulePath);
  return z
    .object({
      sortReservationConflicts: z.custom<(input: Conflict[]) => Conflict[]>(
        (value) => typeof value === 'function',
      ),
    })
    .parse(loaded).sortReservationConflicts;
}
function conflict(emojiKey: string, entityId: string | null = 'task-a'): Conflict {
  return conflictSchema.parse({
    reason: 'task_marker_collision',
    emoji_key: emojiKey,
    reservation_project_slug: 'alpha',
    conflicting_project_slug: 'beta',
    entity_id: entityId,
  });
}

it('compares diagnostic key strings by Unicode scalar values rather than UTF-16 code units', async () => {
  // The comparison primitive handles opaque strings; glyph validation is a separate boundary.
  const bmp = conflict('\uE000');
  const supplementary = conflict('\u{10000}');
  const values = [supplementary, bmp];
  expect('\u{10000}' < '\uE000').toBe(true);
  expect((await sorter())(values)).toEqual([bmp, supplementary]);
  expect(values).toEqual([supplementary, bmp]);
});

it('orders the full conflict tuple, places null before text, and returns distinct diagnostics', async () => {
  const plain = conflict('🧭');
  const absent = conflict('🧭', null);
  const owner: Conflict = { ...plain, reason: 'reservation_owner_mismatch', entity_id: null };
  const project: Conflict = {
    ...plain,
    reason: 'project_marker_collision',
    entity_id: 'project-a',
  };
  const other = { ...plain, reservation_project_slug: 'gamma' };
  expect((await sorter())([other, plain, project, absent, owner, { ...plain }])).toEqual([
    project,
    owner,
    absent,
    plain,
    other,
  ]);
});
