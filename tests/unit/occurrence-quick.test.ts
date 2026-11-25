import { describe, expect, it } from 'vitest';
import {
  selectionBlocksQuick,
  type SelectedOccurrence,
} from '../../web/src/screens/occurrence-model.js';

const row: SelectedOccurrence = {
  id: 'occ-1',
  revision: 1,
  state: 'debt',
  deadline: '2026-11-18T10:00:00.000Z',
  date: '',
  time: '',
  offset: '',
};

describe('one-tap completion never discards a selection', () => {
  it.each([
    ['nothing selected', [], false],
    ['this row, no time entered', [row], false],
    ['another row', [{ ...row, id: 'occ-2' }], true],
    ['this row with an entered time', [{ ...row, date: '2026-11-18', time: '09:30' }], true],
  ] as const)('%s', (_name, selected, blocked) => {
    expect(selectionBlocksQuick(selected, 'occ-1')).toBe(blocked);
  });
});
