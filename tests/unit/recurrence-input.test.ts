import { expect, it } from 'vitest';
import { z } from 'zod/mini';
import { randomUUID } from 'node:crypto';
import {
  completeOccurrencesSchema,
  cancelOccurrencesSchema,
  controlRecurrenceSchema,
  tickRecurrenceSchema,
} from '../../src/schema/recurrence-input.js';
async function inputSchema() {
  const path = '../../src/schema/recurrence-input.js';
  const loaded: unknown = await import(path);
  return z
    .object({
      recurrenceInputSchema: z.custom<z.ZodMiniType>((value) => value instanceof z.ZodMiniType),
    })
    .parse(loaded).recurrenceInputSchema;
}
function validInput() {
  return {
    first_deadline: '2026-10-21T06:00:00.000Z',
    miss_policy: 'carry_forward',
    confirmation_window_ms: 0,
    schedule: { mode: 'calendar', pattern: 'days', every: 1, local_time: '09:00:00.000' },
  };
}
it('requires explicit first seed, miss policy and confirmation window', async () => {
  const schema = await inputSchema();
  expect(schema.safeParse(validInput()).success).toBe(true);
  for (const field of ['first_deadline', 'miss_policy', 'confirmation_window_ms']) {
    const input: Record<string, unknown> = validInput();
    delete input[field];
    expect(schema.safeParse(input).success, field).toBe(false);
  }
});
it('accepts every timing pattern independently of both policies and window endpoints', async () => {
  const schema = await inputSchema();
  for (const every of [1, 3650]) {
    const schedules = [
      { mode: 'calendar', pattern: 'days', every, local_time: '09:00:00.000' },
      { mode: 'calendar', pattern: 'weeks', every, local_time: '09:00:00.000' },
      { mode: 'calendar', pattern: 'weekdays', weekdays: [7, 1], local_time: '09:00:00.000' },
      { mode: 'calendar', pattern: 'months', every, day_of_month: 31, local_time: '09:00:00.000' },
      { mode: 'after_completion', unit: 'hours', every },
      { mode: 'after_completion', unit: 'days', every },
    ];
    for (const schedule of schedules)
      for (const miss_policy of ['carry_forward', 'record_miss'])
        for (const confirmation_window_ms of [0, 2592000000])
          expect(
            schema.safeParse({ ...validInput(), schedule, miss_policy, confirmation_window_ms })
              .success,
          ).toBe(true);
  }
});
it('rejects out-of-range or fractional windows and intervals without rounding', async () => {
  const schema = await inputSchema();
  for (const confirmation_window_ms of [-1, 0.5, 2592000001])
    expect(schema.safeParse({ ...validInput(), confirmation_window_ms }).success).toBe(false);
  for (const every of [0, -1, 0.5, 3651]) {
    for (const schedule of [
      { ...validInput().schedule, every },
      { mode: 'after_completion', unit: 'hours', every },
    ])
      expect(schema.safeParse({ ...validInput(), schedule }).success).toBe(false);
  }
});
it('validates distinct ISO weekdays, requested month day and exact local milliseconds', async () => {
  const schema = await inputSchema();
  for (const weekdays of [[], [1, 1], [0], [8], [1.5]])
    expect(
      schema.safeParse({
        ...validInput(),
        schedule: { mode: 'calendar', pattern: 'weekdays', weekdays, local_time: '09:00:00.000' },
      }).success,
    ).toBe(false);
  for (const day_of_month of [0, 32, 1.5])
    expect(
      schema.safeParse({
        ...validInput(),
        schedule: { ...validInput().schedule, pattern: 'months', day_of_month },
      }).success,
    ).toBe(false);
  for (const local_time of [
    '09:00',
    '9:00:00.000',
    '24:00:00.000',
    '09:60:00.000',
    '09:00:60.000',
    '09:00:00.00',
  ])
    expect(
      schema.safeParse({ ...validInput(), schedule: { ...validInput().schedule, local_time } })
        .success,
    ).toBe(false);
});
it('rejects caller clocks, timezone, derived deadline and unsupported rules', async () => {
  const schema = await inputSchema();
  for (const field of ['now', 'timezone', 'deadline', 'display_deadline', 'unknown'])
    expect(schema.safeParse({ ...validInput(), [field]: '2026-10-21T06:00:00.000Z' }).success).toBe(
      false,
    );
  for (const change of [
    { miss_policy: 'ignore' },
    { first_deadline: 'tomorrow' },
    { schedule: { mode: 'cron', expression: '* * * * *' } },
    { schedule: { ...validInput().schedule, timezone: 'UTC' } },
  ])
    expect(schema.safeParse({ ...validInput(), ...change }).success).toBe(false);
});
const batchSchemas = [
  { name: 'completion', schema: completeOccurrencesSchema, extra: {} },
  {
    name: 'cancellation',
    schema: cancelOccurrencesSchema,
    extra: { reason: 'Перенесено владельцем' },
  },
];
function selectedOccurrence() {
  return { id: randomUUID(), expected_revision: 1 };
}
it.each(batchSchemas)(
  '$name requires nonempty distinct selections with positive integer revisions',
  ({ schema, extra }) => {
    const selected = selectedOccurrence();
    expect(schema.safeParse({ occurrences: [selected], ...extra }).success).toBe(true);
    expect(schema.safeParse({ occurrences: [], ...extra }).success).toBe(false);
    expect(schema.safeParse({ occurrences: [selected, selected], ...extra }).success).toBe(false);
    expect(
      schema.safeParse({ occurrences: [selected, { ...selected, expected_revision: 2 }], ...extra })
        .success,
    ).toBe(false);
    for (const id of ['', 'task-marker', 7, null])
      expect(schema.safeParse({ occurrences: [{ ...selected, id }], ...extra }).success).toBe(
        false,
      );
    for (const expected_revision of [0, -1, 1.5, '1', null, undefined])
      expect(
        schema.safeParse({ occurrences: [{ ...selected, expected_revision }], ...extra }).success,
      ).toBe(false);
  },
);
it.each(batchSchemas)(
  '$name permits a real large selection without a statement-chunk product cap',
  ({ schema, extra }) => {
    const occurrences = Array.from({ length: 257 }, selectedOccurrence);
    expect(schema.parse({ occurrences, ...extra })).toEqual({ occurrences, ...extra });
  },
);
it('completion preserves optional actual instants and delegates clock comparisons to the command', () => {
  const selected = selectedOccurrence();
  expect(completeOccurrencesSchema.parse({ occurrences: [selected] })).toEqual({
    occurrences: [selected],
  });
  for (const actual_completed_at of ['2026-10-21T09:00:00.123+03:00', '2090-01-01T00:00:00.000Z'])
    expect(
      completeOccurrencesSchema.parse({ occurrences: [{ ...selected, actual_completed_at }] }),
    ).toEqual({ occurrences: [{ ...selected, actual_completed_at }] });
  expect(
    completeOccurrencesSchema.parse({
      occurrences: [{ ...selected, actual_completed_at: '2026-10-21t06:00:00.123z' }],
    }).occurrences[0]?.actual_completed_at,
  ).toBe('2026-10-21T06:00:00.123Z');
  for (const actual_completed_at of [
    null,
    0,
    '',
    '2026-10-21',
    '2026-10-21T06:00:00',
    '2026-02-30T06:00:00Z',
    '2026-10-21T06:00:00.1234Z',
    '2026-10-21T06:00:60Z',
  ])
    expect(
      completeOccurrencesSchema.safeParse({ occurrences: [{ ...selected, actual_completed_at }] })
        .success,
    ).toBe(false);
});
it.each(batchSchemas)(
  '$name rejects unknown row and command fields instead of dropping caller input',
  ({ schema, extra }) => {
    const selected = selectedOccurrence();
    for (const key of ['now', 'actor', 'deadline', 'task_id', 'project_slug']) {
      expect(
        schema.safeParse({ occurrences: [selected], ...extra, [key]: 'unexpected' }).success,
      ).toBe(false);
      expect(
        schema.safeParse({ occurrences: [{ ...selected, [key]: 'unexpected' }], ...extra }).success,
      ).toBe(false);
    }
    const input: unknown = JSON.parse(
      JSON.stringify({ occurrences: [selected], ...extra }).replace(
        /}$/,
        ',"__proto__":{"hidden":true}}',
      ),
    );
    expect(schema.safeParse(input).success).toBe(false);
  },
);
it('cancellation requires meaningful well-formed reason and cannot supply an actual completion', () => {
  const occurrences = [selectedOccurrence()];
  const reason = '  Перенесено по решению владельца.\nПовторное решение отдельно.  ';
  expect(cancelOccurrencesSchema.parse({ occurrences, reason }).reason).toBe(reason);
  for (const invalid of [undefined, null, '', ' \n ', String.fromCharCode(0xd800)])
    expect(cancelOccurrencesSchema.safeParse({ occurrences, reason: invalid }).success).toBe(false);
  expect(
    cancelOccurrencesSchema.safeParse({
      occurrences: [{ ...occurrences[0], actual_completed_at: '2026-10-21T06:00:00Z' }],
      reason,
    }).success,
  ).toBe(false);
});
it('control accepts explicit optional restart and defers configured consent to the command', () => {
  const minimal = { to_status_id: 'paused' };
  expect(controlRecurrenceSchema.parse(minimal)).toEqual(minimal);
  const explicit = {
    to_status_id: 'active',
    first_deadline: '2026-10-21T06:00:00.123Z',
    confirmation: { asserted: true, user_text: 'Возобновить эту задачу' },
  };
  expect(controlRecurrenceSchema.parse(explicit)).toEqual(explicit);
  // A required but incomplete confirmation must yield CONFIRMATION_REQUIRED in
  // configured core context, rather than becoming a schema VALIDATION_ERROR.
  expect(
    controlRecurrenceSchema.safeParse({ ...minimal, confirmation: { asserted: false } }).success,
  ).toBe(true);
  for (const to_status_id of ['', 'Статус', 'active space', null, 1])
    expect(controlRecurrenceSchema.safeParse({ to_status_id }).success).toBe(false);
  expect(
    controlRecurrenceSchema.safeParse({ to_status_id: 'active', first_deadline: '2026-10-21' })
      .success,
  ).toBe(false);
});
it('control rejects derived deadlines, settings, actor overrides and unknown own keys', () => {
  for (const field of [
    'now',
    'deadline',
    'display_deadline',
    'timezone',
    'category',
    'actor',
    'unknown',
  ])
    expect(
      controlRecurrenceSchema.safeParse({ to_status_id: 'active', [field]: 'unexpected' }).success,
    ).toBe(false);
  const input: unknown = JSON.parse('{"to_status_id":"active","__proto__":{"ignored":true}}');
  expect(controlRecurrenceSchema.safeParse(input).success).toBe(false);
});
it('tick requires explicit distinct valid parent claims without an arbitrary total batch limit', () => {
  const task = { task_id: randomUUID(), expected_revision: 1 };
  expect(tickRecurrenceSchema.parse({ tasks: [task] })).toEqual({ tasks: [task] });
  expect(tickRecurrenceSchema.safeParse({ tasks: [] }).success).toBe(false);
  expect(
    tickRecurrenceSchema.safeParse({ tasks: [task, { ...task, expected_revision: 2 }] }).success,
  ).toBe(false);
  for (const change of [
    { task_id: 'emoji' },
    { expected_revision: 0 },
    { expected_revision: 1.5 },
    { expected_revision: '1' },
    { now: 0 },
  ])
    expect(tickRecurrenceSchema.safeParse({ tasks: [{ ...task, ...change }] }).success).toBe(false);
  expect(tickRecurrenceSchema.safeParse({ tasks: [task], now: 0 }).success).toBe(false);
  expect(
    tickRecurrenceSchema.parse({
      tasks: Array.from({ length: 257 }, () => ({ task_id: randomUUID(), expected_revision: 1 })),
    }).tasks,
  ).toHaveLength(257);
});
