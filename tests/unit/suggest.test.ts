import { expect, it } from 'vitest';
import { editDistance, suggestNames } from '../../src/cli/suggest.js';

it('counts an adjacent transposition as one edit', () => {
  expect(editDistance('tsak', 'task')).toBe(1);
  expect(editDistance('expected-revison', 'expected-revision')).toBe(1);
  expect(editDistance('', 'abc')).toBe(3);
});

it('suggests only known names close enough to the input', () => {
  expect(suggestNames('tsak', ['task', 'project', 'tasks'])).toEqual(['task']);
  expect(suggestNames('--expected-revison', ['--expected-revision', '--project'])).toEqual([
    '--expected-revision',
  ]);
  expect(suggestNames('zzzz', ['task', 'project'])).toEqual([]);
});
