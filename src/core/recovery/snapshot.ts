import Database from 'better-sqlite3';
import * as z from 'zod/mini';
import { backupInfoSchema, type BackupInfo } from '../../schema/recovery.js';
import { revisionSchema, slugSchema, timezoneSchema, uuidSchema } from '../../schema/values.js';
import { domainError, normalizeError } from '../errors.js';
import { fileChecksum, verifyManagedFile } from './files.js';

const stateSchema = z.object({
  database_epoch: uuidSchema,
  timezone: timezoneSchema,
  schema_version: z.literal(1),
  revision: revisionSchema,
  read_revision: revisionSchema,
});
const projectsSchema = z.array(
  z.strictObject({
    project_slug: slugSchema,
    revision: revisionSchema,
    config_revision: revisionSchema,
  }),
);
export function snapshotMetadata(sqlite: Database.Database) {
  const state = stateSchema.parse(
    sqlite.prepare('SELECT * FROM application_state WHERE id=1').get(),
  );
  const projects = projectsSchema.parse(
    sqlite
      .prepare('SELECT slug AS project_slug,revision,config_revision FROM projects ORDER BY slug')
      .all(),
  );
  return { state, projects };
}
export function verifySnapshot(sqlite: Database.Database): void {
  const foreignKeys = sqlite.pragma('foreign_key_check');
  if (
    sqlite.pragma('integrity_check', { simple: true }) !== 'ok' ||
    !Array.isArray(foreignKeys) ||
    foreignKeys.length !== 0
  )
    throw domainError('VALIDATION_ERROR', 'The managed snapshot failed SQLite integrity checks');
  snapshotMetadata(sqlite);
}
/** Only a private completed copy changes journal mode; the live WAL is untouched. */
export function finalizeSnapshot(path: string): void {
  const sqlite = new Database(path, { fileMustExist: true });
  try {
    if (sqlite.pragma('journal_mode = DELETE', { simple: true }) !== 'delete')
      throw domainError('INTERNAL_ERROR', 'The standalone snapshot could not be finalized');
  } finally {
    sqlite.close();
  }
}
export async function openSnapshot(path: string) {
  await verifyManagedFile(path);
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  try {
    sqlite.pragma('query_only = ON');
    if (sqlite.pragma('journal_mode', { simple: true }) !== 'delete')
      throw domainError('VALIDATION_ERROR', 'The managed snapshot is not self-contained');
    verifySnapshot(sqlite);
    return sqlite;
  } catch (error) {
    sqlite.close();
    throw normalizeError(error);
  }
}
export async function describeSnapshot(path: string, identity: { id: string; createdAt: string }) {
  const sqlite = await openSnapshot(path);
  try {
    const { state, projects } = snapshotMetadata(sqlite);
    const info = backupInfoSchema.parse({
      id: identity.id,
      created_at: identity.createdAt,
      database_epoch: state.database_epoch,
      schema_version: state.schema_version,
      checksum: await fileChecksum(path),
      size_bytes: (await verifyManagedFile(path)).size,
      settings_revision: state.revision,
      projects,
    });
    return { info, state };
  } finally {
    sqlite.close();
  }
}
export async function verifiedSnapshot(path: string, expected: BackupInfo) {
  if (
    (await verifyManagedFile(path)).size !== expected.size_bytes ||
    (await fileChecksum(path)) !== expected.checksum
  )
    throw domainError(
      'VALIDATION_ERROR',
      'The managed snapshot checksum does not match its manifest',
    );
  const sqlite = await openSnapshot(path);
  try {
    const { state, projects } = snapshotMetadata(sqlite);
    if (
      state.database_epoch !== expected.database_epoch ||
      state.schema_version !== expected.schema_version ||
      state.revision !== expected.settings_revision ||
      JSON.stringify(projects) !== JSON.stringify(expected.projects)
    )
      throw domainError(
        'VALIDATION_ERROR',
        'The managed snapshot metadata does not match its manifest',
      );
    return sqlite;
  } catch (error) {
    sqlite.close();
    throw normalizeError(error);
  }
}
