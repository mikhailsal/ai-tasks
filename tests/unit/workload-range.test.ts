import { expect, it } from 'vitest';
import {
  statisticsPath,
  workloadRange,
  workloadRangeHref,
} from '../../web/src/screens/workload-range.js';

it('statistics URL keeps explicit filters and full priority JSON without accepting clocks or pagination', () => {
  const search =
    '?project_slug=alpha&q=100%25_&priority=%7B%22model%22%3A%22numeric%22%2C%22value%22%3A1.001%7D&include_terminal=true';
  const url = new URL(statisticsPath(search), 'http://local.invalid');
  expect(url.searchParams.get('project_slug')).toBe('alpha');
  expect(url.searchParams.get('q')).toBe('100%_');
  expect(JSON.parse(url.searchParams.get('priority') ?? '')).toEqual({
    model: 'numeric',
    value: 1.001,
  });
  for (const input of [
    '?all_projects=true&limit=1',
    '?all_projects=true&cursor=x',
    '?all_projects=true&as_of=2026-01-01T00:00:00.000Z',
    '?all_projects=true&now=x',
    '?all_projects=true&__proto__=x',
  ])
    expect(() => statisticsPath(input)).toThrow();
});
it('statistics defaults the visible aggregate scope explicitly and rejects duplicate or conflicting scope', () => {
  expect(statisticsPath('')).toBe('/stats?all_projects=true');
  for (const input of [
    '?project_slug=alpha&all_projects=true',
    '?project_slug=alpha&project_slug=alpha',
    '?all_projects=false',
    '?all_projects=true&include_terminal=no',
  ])
    expect(() => statisticsPath(input)).toThrow();
});
it('range fields interpret exact URL instants in their response timezone and preserve milliseconds', () => {
  const draft = workloadRange('?from=2026-10-21T10%3A02%3A03.123Z', 'Europe/Moscow');
  expect(draft).toEqual({
    timezone: 'Europe/Moscow',
    from: { date: '2026-10-21', time: '13:02:03.123', offset: '+03:00' },
    to: { date: '', time: '', offset: '' },
  });
  expect(
    new URL(
      workloadRangeHref('?project_slug=alpha&q=plain', draft),
      'http://local.invalid',
    ).searchParams.get('from'),
  ).toBe('2026-10-21T10:02:03.123Z');
});
it('equal precise bounds remain an accepted empty range and retain scope/filters without cursors', () => {
  const draft = workloadRange(
    '?from=2026-10-21T10%3A02%3A03.123Z&to=2026-10-21T10%3A02%3A03.123Z',
    'Europe/Moscow',
  );
  const url = new URL(
    workloadRangeHref('?project_slug=alpha&q=100%25&cursor=old&limit=1&archive=include', draft),
    'http://local.invalid',
  );
  expect(url.searchParams.get('from')).toBe(url.searchParams.get('to'));
  expect(url.searchParams.get('project_slug')).toBe('alpha');
  expect(url.searchParams.get('q')).toBe('100%');
  expect(url.searchParams.get('archive')).toBe('include');
  expect(url.searchParams.has('cursor')).toBe(false);
  expect(url.searchParams.has('limit')).toBe(false);
});
it('reversed or partially entered bounds reject before any navigation request can be built', () => {
  const draft = workloadRange(
    '?from=2026-10-22T10%3A00%3A00.000Z&to=2026-10-21T10%3A00%3A00.000Z',
    'Europe/Moscow',
  );
  expect(() => workloadRangeHref('', draft)).toThrow('Начало периода позже конца');
  draft.from = { date: '2026-10-21', time: '', offset: '' };
  expect(() => workloadRangeHref('', draft)).toThrow();
});
it('clearing either or both bounds keeps open-ended and unbounded meanings', () => {
  const draft = workloadRange(
    '?from=2026-10-21T10%3A00%3A00.000Z&to=2026-10-22T10%3A00%3A00.000Z',
    'Europe/Moscow',
  );
  draft.from = { date: '', time: '', offset: '' };
  const one = new URL(
    workloadRangeHref('?all_projects=true&from=old&to=old', draft),
    'http://local.invalid',
  );
  expect(one.searchParams.has('from')).toBe(false);
  expect(one.searchParams.get('to')).toBe('2026-10-22T10:00:00.000Z');
  draft.to = { date: '', time: '', offset: '' };
  expect(workloadRangeHref('', draft)).toBe('/workload?all_projects=true');
});
it('ambiguous range input requires offset and nonexistent local time cannot produce a query', () => {
  const draft = workloadRange('', 'America/New_York');
  draft.from = { date: '2026-11-01', time: '01:30:00.123', offset: '' };
  expect(() => workloadRangeHref('', draft)).toThrow('Выберите смещение');
  draft.from.offset = '-05:00';
  expect(
    new URL(workloadRangeHref('', draft), 'http://local.invalid').searchParams.get('from'),
  ).toBe('2026-11-01T06:30:00.123Z');
  draft.from = { date: '2026-03-08', time: '02:30:00.000', offset: '' };
  expect(() => workloadRangeHref('', draft)).toThrow('не существует');
});
