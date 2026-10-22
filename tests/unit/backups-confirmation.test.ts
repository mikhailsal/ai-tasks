import { expect, it } from 'vitest';
import { backupConfirmationBaseMatches } from '../../web/src/screens/backups-confirmation-model.js';

const current = {
  database_epoch: 'epoch-a',
  expected_config_revision: 7,
  expected_settings_revision: 4,
};

it('accepts only a saved confirmation draft with the same epoch and both revision guards', () => {
  expect(backupConfirmationBaseMatches(current, current)).toBe(true);
  expect(backupConfirmationBaseMatches({ ...current, database_epoch: 'epoch-b' }, current)).toBe(
    false,
  );
  expect(backupConfirmationBaseMatches({ ...current, expected_config_revision: 8 }, current)).toBe(
    false,
  );
  expect(
    backupConfirmationBaseMatches({ ...current, expected_settings_revision: 5 }, current),
  ).toBe(false);
  expect(backupConfirmationBaseMatches({ database_epoch: current.database_epoch }, current)).toBe(
    false,
  );
});
