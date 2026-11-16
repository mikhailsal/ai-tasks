import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { advisoryCatalogue, advisoryCodes } from '../../src/core/advisories/catalogue.js';
import { collectAdvisories, type Finding } from '../../src/core/advisories/collect.js';
import { hint } from '../../src/core/diagnostics/hints.js';
import { advisorySchema } from '../../src/schema/advisories.js';

/** Spec 010: shape, bounds, order, aggregation, failure isolation and the documented catalogue. */
const database = {} as never;
const request = { operation: 'task.list', projectSlug: 'alpha', data: {} };
const remedy = hint('no_action', 'Nothing to do.');
const finding = (code: Finding['code'], id: string): Finding => ({
  code,
  remedy,
  subject: { type: 'task', id },
});
const ids = (count: number) =>
  Array.from({ length: count }, (_, index) => `t${String(index).padStart(2, '0')}`);

it('nothing applies: no keys at all (US1-2, US4-1)', () => {
  expect(collectAdvisories(database, request, [() => []])).toEqual({});
});

it('orders by catalogue then subject, and every advisory matches the schema (FR-001, FR-004)', () => {
  const found = collectAdvisories(database, request, [
    () => [finding('schedule_time_derived', 'b'), finding('recurring_not_generating', 'z')],
    () => [finding('recurring_not_generating', 'a')],
  ]);
  expect(found.advisories?.map((item) => [item.code, item.subject?.id])).toEqual([
    ['recurring_not_generating', 'a'],
    ['recurring_not_generating', 'z'],
    ['schedule_time_derived', 'b'],
  ]);
  for (const advisory of found.advisories ?? [])
    expect(advisorySchema.parse(advisory)).toEqual(advisory);
});

it('many items with one condition are one advisory with a count (US1-4)', () => {
  const found = collectAdvisories(database, request, [
    () => ids(30).map((id) => finding('recurring_not_generating', id)),
  ]);
  expect(found).toEqual({
    advisories: [
      {
        code: 'recurring_not_generating',
        message: advisoryCatalogue.recurring_not_generating.message,
        remedy,
        count: 30,
      },
    ],
  });
});

it('at most 10, with the omitted count (US1-3)', () => {
  const found = collectAdvisories(
    database,
    request,
    [() => ids(15).map((id) => finding('schedule_time_mismatch', id))],
    Number.POSITIVE_INFINITY,
  );
  expect(found.advisories).toHaveLength(10);
  expect(found.advisories_omitted).toBe(5);
});

it('a failing provider yields no advisory and does not fail the response (FR-002)', () => {
  const found = collectAdvisories(database, request, [
    () => {
      throw new Error('storage detail must not leak');
    },
    () => [finding('schedule_time_derived', 'a')],
  ]);
  expect(found.advisories?.map((item) => item.code)).toEqual(['schedule_time_derived']);
  expect(JSON.stringify(found)).not.toContain('storage detail');
});

it('the catalogue equals docs/advisories.md; messages are short fixed text (FR-003, FR-008, SC-002)', () => {
  const docs = readFileSync(new URL('../../docs/advisories.md', import.meta.url), 'utf8');
  const documented = [...docs.matchAll(/^\| `([a-z0-9_]+)` +\| ([^|]+?) +\|/gmu)].map((match) => [
    match[1],
    match[2]?.trim(),
  ]);
  expect(documented).toEqual(advisoryCodes.map((code) => [code, advisoryCatalogue[code].message]));
  for (const code of advisoryCodes) {
    expect(code).toMatch(/^[a-z][a-z0-9_]{2,47}$/u);
    expect(advisoryCatalogue[code].message.length).toBeLessThanOrEqual(160);
  }
});
