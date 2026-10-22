import { expect, it } from 'vitest';
import {
  appliedReadFilters,
  readFilterDraft,
  readFilterSearch,
} from '../../web/src/components/read-filters.js';

it('preserves explicit project scope, literal search and limit2 while a new filter application drops the cursor', () => {
  const source = '?project_slug=classic&q=100%25_%5C&limit=2&cursor=old';
  const draft = readFilterDraft(source);
  expect(draft).toMatchObject({ scope: 'project', project: 'classic', q: '100%_\\', limit: '2' });
  const query = new URLSearchParams(readFilterSearch(draft, source));
  expect(query.get('project_slug')).toBe('classic');
  expect(query.get('all_projects')).toBeNull();
  expect(query.get('q')).toBe('100%_\\');
  expect(query.get('limit')).toBe('2');
  expect(query.has('cursor')).toBe(false);
});

it.each([
  null,
  { model: 'classic', level: 'critical' },
  { model: 'numeric', value: -1.125 },
  { model: 'eisenhower', important: false, urgent: true },
  { model: 'named', level_id: 'not-in-use' },
])(
  'roundtrips structured priority %j through URL reload without configured model coercion',
  (priority) => {
    const search = `?all_projects=true&priority=${encodeURIComponent(JSON.stringify(priority))}`;
    const draft = readFilterDraft(search);
    const output = new URLSearchParams(readFilterSearch(draft, search));
    expect(JSON.parse(output.get('priority') ?? '"missing"')).toEqual(priority);
    expect(output.get('all_projects')).toBe('true');
  },
);

it('distinguishes any priority from explicit unset and does not substitute a default for invalid incoming JSON', () => {
  const any = readFilterDraft('?all_projects=true');
  expect(new URLSearchParams(readFilterSearch(any, '')).has('priority')).toBe(false);
  const invalid = readFilterDraft('?all_projects=true&priority=%7B');
  expect(invalid.priority).toMatchObject({ mode: 'invalid', invalid: '{' });
  expect(() => readFilterSearch(invalid, '')).toThrow(/приоритета/u);
  const repaired = { ...invalid, priority: { ...invalid.priority, mode: 'unset' as const } };
  expect(new URLSearchParams(readFilterSearch(repaired, '')).get('priority')).toBe('null');
});

it('statistics preserve exact range timestamps but strip list pagination and other former view state', () => {
  const from = '2026-03-28T22:00:00.123Z';
  const to = '2026-03-29T22:00:00.456Z';
  const source = `?project_slug=classic&limit=2&cursor=old&from=${from}&to=${to}`;
  const draft = readFilterDraft(source);
  const output = new URLSearchParams(readFilterSearch(draft, source, true));
  expect(output.get('from')).toBe(from);
  expect(output.get('to')).toBe(to);
  expect(output.has('limit')).toBe(false);
  expect(output.has('cursor')).toBe(false);
  expect(() => readFilterSearch(draft, `${source}&from=${from}`, true)).toThrow(/повторяется/u);
});

it('validates page bounds and numeric precision globally without rounding or accepting blank numbers', () => {
  const draft = readFilterDraft('?all_projects=true');
  for (const limit of ['', '0', '201', '1.5'])
    expect(() => readFilterSearch({ ...draft, limit }, '')).toThrow();
  for (const numeric of ['', '1.0001', '1000000001']) {
    expect(() =>
      readFilterSearch({ ...draft, priority: { ...draft.priority, mode: 'numeric', numeric } }, ''),
    ).toThrow();
  }
  const output = readFilterSearch(
    { ...draft, priority: { ...draft.priority, mode: 'numeric', numeric: '999999999.999' } },
    '',
  );
  expect(JSON.parse(new URLSearchParams(output).get('priority') ?? '{}')).toEqual({
    model: 'numeric',
    value: 999999999.999,
  });
});

it('preserves category/kind/status/emoji/archive and requires an explicit scope repair for conflicting URL scopes', () => {
  const source =
    '?project_slug=classic&kind=recurring&status_id=paused&category=paused&emoji=%F0%9F%A7%AA&archive=only&include_terminal=true';
  const draft = readFilterDraft(source);
  const output = new URLSearchParams(readFilterSearch(draft, source));
  for (const key of [
    'project_slug',
    'kind',
    'status_id',
    'category',
    'emoji',
    'archive',
    'include_terminal',
  ])
    expect(output.get(key)).toBe(new URLSearchParams(source).get(key));
  const conflict = readFilterDraft('?project_slug=classic&all_projects=true');
  expect(conflict.scope).toBe('invalid');
  expect(() => readFilterSearch(conflict, '')).toThrow(/проект/u);
});

it('applied visibility stays explicit and reflects URL filters rather than unsaved form choices', () => {
  const search = '?project_slug=classic&archive=only&include_terminal=true';
  const dirty = readFilterDraft(search);
  dirty.archive = 'exclude';
  dirty.includeTerminal = false;
  expect(appliedReadFilters(search)).toEqual({
    scope: 'Проект: classic',
    archive: 'Только архив',
    visibility: 'Завершённые и отменённые включены',
  });
  expect(appliedReadFilters('?all_projects=true', true)).toMatchObject({
    archive: 'Архив исключён',
    visibility: 'Завершённые включены всегда; отменённые исключены',
  });
  expect(appliedReadFilters('?all_projects=true&include_terminal=true', true).visibility).toBe(
    'Завершённые включены всегда; отменённые включены',
  );
});
