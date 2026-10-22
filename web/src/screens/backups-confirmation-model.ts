export function backupConfirmationBaseMatches(
  saved: {
    database_epoch: string;
    expected_config_revision?: number | undefined;
    expected_settings_revision?: number | undefined;
  },
  current: {
    database_epoch: string;
    expected_config_revision: number;
    expected_settings_revision: number;
  },
) {
  return (
    saved.database_epoch === current.database_epoch &&
    saved.expected_config_revision === current.expected_config_revision &&
    saved.expected_settings_revision === current.expected_settings_revision
  );
}
