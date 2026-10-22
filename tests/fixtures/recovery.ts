import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { z } from 'zod/mini';
import type { CoreContext } from '../../src/core/database/types.js';
import type { MutationEnvelope } from '../../src/schema/envelopes.js';
import type { JsonValue } from '../../src/schema/values.js';
import { createContext } from '../../src/core/context.js';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { openDatabase } from '../../src/core/database/open.js';
import { createProject } from '../../src/core/projects/commands.js';
import { createTask } from '../../src/core/tasks/commands.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { mutationEnvelopeSchema, successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { createTestClock } from './clock.js';

export interface RecoveryConnection {
  sqlite: Database.Database;
  close(): void;
}

export interface RecoveryFixture {
  directory: string;
  databasePath: string;
  backupDirectory: string;
  clock: ReturnType<typeof createTestClock>;
  connection: RecoveryConnection;
  context: CoreContext;
  actor: string;
  epoch(): string;
  mutation(
    payload: JsonValue,
    options?: { projectSlug?: string; revision?: number },
  ): MutationEnvelope;
  closeDatabaseForRestore(): void;
  reopen(): void;
  cloneDatabase(): Promise<string>;
  cleanupClone(path: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Opens a migrated temporary database with the production connection-lifetime lock.
 * Restore tests can release the shared lock without deleting the live file, then reopen
 * after a helper replaces it.
 */
export async function createRecoveryFixture(): Promise<RecoveryFixture> {
  const directory = await mkdtemp(join(tmpdir(), 'ai-tasks-recovery-'));
  const databasePath = join(directory, 'application.sqlite');
  const backupDirectory = join(directory, 'backups');
  await mkdir(backupDirectory);
  const clock = createTestClock(Date.UTC(2026, 9, 21, 10, 0, 0, 123));
  const actor = 'human-web';
  let connection: ReturnType<typeof openDatabase> | undefined;
  let lock: ReturnType<typeof acquireDatabaseLock> | undefined;
  let closed = false;

  function open() {
    lock = acquireDatabaseLock({ databasePath, mode: 'shared' });
    try {
      connection = openDatabase({ path: databasePath, lock, now: clock.now });
      return connection;
    } catch (error) {
      releaseDatabaseLock(lock);
      lock = undefined;
      throw error;
    }
  }

  function closeDatabaseForRestore() {
    if (!connection || !lock) return;
    const current = connection;
    const currentLock = lock;
    connection = undefined;
    lock = undefined;
    try {
      current.close();
    } finally {
      releaseDatabaseLock(currentLock);
    }
  }

  function requireConnection() {
    if (!connection) throw new Error('Recovery fixture database is closed');
    return connection;
  }

  function epoch() {
    const row: unknown = requireConnection()
      .sqlite.prepare('SELECT database_epoch FROM application_state WHERE id=1')
      .get();
    const parsed = z.optional(z.strictObject({ database_epoch: z.string() })).parse(row);
    if (!parsed) throw new Error('Recovery fixture has no database epoch');
    return parsed.database_epoch;
  }

  function mutation(payload: JsonValue, options: { projectSlug?: string; revision?: number } = {}) {
    const projectSlug = options.projectSlug ?? 'alpha';
    const row: unknown = requireConnection()
      .sqlite.prepare('SELECT config_revision FROM projects WHERE slug=?')
      .get(projectSlug);
    const parsed = z.optional(z.strictObject({ config_revision: z.int() })).parse(row);
    return mutationEnvelopeSchema.parse({
      operation_id: randomUUID(),
      database_epoch: epoch(),
      ...(options.revision === undefined ? {} : { expected_revision: options.revision }),
      ...(parsed ? { expected_config_revision: parsed.config_revision } : {}),
      payload,
    });
  }

  try {
    open();
    if (!connection) throw new Error('Recovery fixture failed to open');
    migrateDatabase(connection);
  } catch (error) {
    closeDatabaseForRestore();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  const fixture: RecoveryFixture = {
    directory,
    databasePath,
    backupDirectory,
    clock,
    actor,
    get connection() {
      return requireConnection();
    },
    get context() {
      return createContext({ connection: requireConnection(), actor, now: clock.now });
    },
    epoch,
    mutation,
    closeDatabaseForRestore,
    reopen() {
      if (connection) throw new Error('Recovery fixture database is already open');
      open();
    },
    async cloneDatabase() {
      const cloneDirectory = await mkdtemp(join(tmpdir(), 'ai-tasks-recovery-clone-'));
      const clonePath = join(cloneDirectory, 'application.sqlite');
      try {
        await requireConnection().sqlite.backup(clonePath);
        return clonePath;
      } catch (error) {
        await rm(cloneDirectory, { recursive: true, force: true });
        throw error;
      }
    },
    async cleanupClone(path) {
      await rm(dirname(path), { recursive: true, force: true });
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        closeDatabaseForRestore();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
  return fixture;
}

export async function seedRecoveryProject(
  fixture: RecoveryFixture,
  projectSlug: string,
  emoji: string,
) {
  return createProject(
    fixture.context,
    projectSlug,
    fixture.mutation({ slug: projectSlug, name: projectSlug, emoji }, { projectSlug }),
  );
}

export async function seedRecoveryTask(
  fixture: RecoveryFixture,
  input: { projectSlug: string; title: string; emoji: string; description?: string },
) {
  return createTask(
    fixture.context,
    input.projectSlug,
    fixture.mutation(
      {
        kind: 'ordinary',
        title: input.title,
        emoji: input.emoji,
        ...(input.description === undefined ? {} : { description: input.description }),
      },
      { projectSlug: input.projectSlug },
    ),
  );
}

/** Loads the recovery API only when its implementation lands; absence is not a test result. */
export async function loadRecoveryApi(): Promise<RecoveryApi> {
  const modulePath = '../../src/core/recovery/index.js';
  const loaded: unknown = await import(modulePath);
  return recoveryApiSchema.parse(loaded);
}

/** Loads only the implemented backup surface, allowing backup tests to run before restore lands. */
export async function loadBackupApi(): Promise<BackupApi> {
  const modulePath = '../../src/core/recovery/index.js';
  const loaded: unknown = await import(modulePath);
  return backupApiSchema.parse(loaded);
}

export function makeBackupEnvelope(
  fixture: RecoveryFixture,
  projectSlug = 'alpha',
  operationId = randomUUID(),
): MutationEnvelope {
  const state: unknown = fixture.connection.sqlite
    .prepare('SELECT revision FROM application_state WHERE id=1')
    .get();
  const parsedState = z.optional(z.strictObject({ revision: z.int() })).parse(state);
  const base = fixture.mutation({}, { projectSlug });
  return mutationEnvelopeSchema.parse({
    ...base,
    operation_id: operationId,
    expected_settings_revision: parsedState?.revision ?? 1,
  });
}

export async function backupWhileWriterCommits(
  fixture: RecoveryFixture,
  createBackup: () => Promise<unknown>,
): Promise<unknown> {
  const workerPath = fileURLToPath(new URL('./recovery-writer.mjs', import.meta.url));
  const child = fork(workerPath, [fixture.databasePath], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const waitFor = (expected: 'ready' | 'writing' | 'complete') =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new Error(`Recovery writer missed ${expected}`)),
        10_000,
      );
      const finish = (error?: Error) => {
        clearTimeout(timer);
        child.off('message', onMessage);
        child.off('error', onError);
        child.off('exit', onExit);
        if (error) reject(error);
        else resolve();
      };
      const onMessage = (message: unknown) => {
        const parsed = z
          .strictObject({ type: z.enum(['ready', 'writing', 'complete']) })
          .safeParse(message);
        if (parsed.success && parsed.data.type === expected) finish();
      };
      const onError = (error: Error) => finish(error);
      const onExit = () => finish(new Error(`Recovery writer exited before ${expected}`));
      child.on('message', onMessage);
      child.once('error', onError);
      child.once('exit', onExit);
    });
  let complete: Promise<void> | undefined;
  try {
    const ready = waitFor('ready');
    await ready;
    const writing = waitFor('writing');
    complete = waitFor('complete');
    child.send({ type: 'start' });
    await writing;
    const result = await createBackup();
    await complete;
    return result;
  } finally {
    // The writer may still be completing if backup creation fails.
    await complete?.catch(() => {});
    if (child.connected) child.send({ type: 'close' });
    if (child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 2_000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}

export async function runRecoveryRestore(
  fixture: RecoveryFixture,
  input: {
    backupId: string;
    projectSlug?: string;
    affectedProjects: Array<{
      project_slug: string;
      expected_revision: number | null;
      expected_config_revision: number | null;
    }>;
    operationId?: string;
    settingsRevision?: number;
    databaseEpoch?: string;
    failpoint?: (name: string) => void | Promise<void>;
    reopenAfter?: boolean;
    envelope?: MutationEnvelope;
  },
): Promise<RestoreResult> {
  const api = await loadRecoveryApi();
  const projectSlug = input.projectSlug ?? 'alpha';
  const envelope = input.envelope ?? makeRestoreEnvelope(fixture, { ...input, projectSlug });
  fixture.closeDatabaseForRestore();
  let lock: ReturnType<typeof acquireDatabaseLock> | undefined;
  try {
    lock = acquireDatabaseLock({ databasePath: fixture.databasePath, mode: 'exclusive' });
    return await api.runRestore({
      databasePath: fixture.databasePath,
      lock,
      backupDirectory: fixture.backupDirectory,
      projectSlug,
      envelope,
      actor: fixture.actor,
      now: fixture.clock.now,
      ...(input.failpoint === undefined ? {} : { failpoint: input.failpoint }),
    });
  } finally {
    try {
      if (lock) releaseDatabaseLock(lock);
    } finally {
      if (input.reopenAfter !== false) fixture.reopen();
    }
  }
}

export function makeRestoreEnvelope(
  fixture: RecoveryFixture,
  input: {
    backupId: string;
    affectedProjects: Array<{
      project_slug: string;
      expected_revision: number | null;
      expected_config_revision: number | null;
    }>;
    operationId?: string;
    settingsRevision?: number;
    databaseEpoch?: string;
    projectSlug?: string;
  },
): MutationEnvelope {
  const settings: unknown = fixture.connection.sqlite
    .prepare('SELECT revision FROM application_state WHERE id=1')
    .get();
  const parsedSettings = z.optional(z.strictObject({ revision: z.int() })).parse(settings);
  const project: unknown = fixture.connection.sqlite
    .prepare('SELECT config_revision FROM projects WHERE slug=?')
    .get(input.projectSlug ?? 'alpha');
  const parsedProject = z.optional(z.strictObject({ config_revision: z.int() })).parse(project);
  return mutationEnvelopeSchema.parse({
    operation_id: input.operationId ?? randomUUID(),
    database_epoch: input.databaseEpoch ?? fixture.epoch(),
    ...(parsedProject ? { expected_config_revision: parsedProject.config_revision } : {}),
    expected_settings_revision: input.settingsRevision ?? parsedSettings?.revision ?? 1,
    payload: {
      backup_id: input.backupId,
      affected_projects: input.affectedProjects,
      confirmation: { asserted: true, user_text: 'Подтверждаю восстановление' },
    },
  });
}

export interface RecoveryApi {
  createBackup(
    context: CoreContext,
    projectSlug: string,
    envelope: MutationEnvelope,
    options: { backupDirectory: string },
  ): Promise<BackupEnvelope>;
  listBackups(
    context: CoreContext,
    input: { all_projects: true; limit?: number; cursor?: string },
    options?: { backupDirectory: string },
  ): Promise<BackupListEnvelope>;
  validateBackup(
    context: CoreContext,
    backupId: string,
    options: { backupDirectory: string },
  ): Promise<BackupValidationEnvelope>;
  runRestore(input: RestoreInput): Promise<RestoreResult>;
  recoverDatabase(input: {
    databasePath: string;
    lock: ReturnType<typeof acquireDatabaseLock>;
    backupDirectory: string;
    now?: () => number;
    failpoint?: (name: string) => void | Promise<void>;
  }): Promise<void>;
  getRecoveryStatus(input: {
    backupDirectory: string;
    jobId?: string;
    operationId?: string;
  }): unknown;
}

export type BackupApi = Pick<
  RecoveryApi,
  'createBackup' | 'listBackups' | 'validateBackup' | 'getRecoveryStatus'
>;

export interface BackupInfo {
  id: string;
  created_at: string;
  database_epoch: string;
  schema_version: 1;
  checksum: string;
  size_bytes: number;
  settings_revision: number;
  projects: Array<{ project_slug: string; revision: number; config_revision: number }>;
}

export interface BackupValidation {
  backup: BackupInfo;
  compatible: true;
  integrity: 'ok';
  affected_projects: Array<{
    project_slug: string;
    expected_revision: number | null;
    expected_config_revision: number | null;
  }>;
}

const backupInfoSchema = z.strictObject({
  id: z.string(),
  created_at: z.string(),
  database_epoch: z.string(),
  schema_version: z.literal(1),
  checksum: z.string(),
  size_bytes: z.int(),
  settings_revision: z.int(),
  projects: z.array(
    z.strictObject({
      project_slug: z.string(),
      revision: z.int(),
      config_revision: z.int(),
    }),
  ),
});
const backupValidationSchema = z.strictObject({
  backup: backupInfoSchema,
  compatible: z.literal(true),
  integrity: z.literal('ok'),
  affected_projects: z.array(
    z.strictObject({
      project_slug: z.string(),
      expected_revision: z.nullable(z.int()),
      expected_config_revision: z.nullable(z.int()),
    }),
  ),
});
export const backupEnvelopeSchema = z.extend(successEnvelopeSchema, { data: backupInfoSchema });
export const backupListEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: z.strictObject({ items: z.array(backupInfoSchema), next_cursor: z.nullable(z.string()) }),
});
export const backupValidationEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: backupValidationSchema,
});
const isFunction = (value: unknown): value is (...args: never[]) => unknown =>
  typeof value === 'function';
// Module capabilities may grow; public payload/envelope schemas remain strict.
const recoveryApiSchema = z.object({
  createBackup: z.custom<RecoveryApi['createBackup']>(isFunction),
  listBackups: z.custom<RecoveryApi['listBackups']>(isFunction),
  validateBackup: z.custom<RecoveryApi['validateBackup']>(isFunction),
  runRestore: z.custom<RecoveryApi['runRestore']>(isFunction),
  recoverDatabase: z.custom<RecoveryApi['recoverDatabase']>(isFunction),
  getRecoveryStatus: z.custom<RecoveryApi['getRecoveryStatus']>(isFunction),
});
const backupApiSchema = z.object({
  createBackup: z.custom<RecoveryApi['createBackup']>(isFunction),
  listBackups: z.custom<RecoveryApi['listBackups']>(isFunction),
  validateBackup: z.custom<RecoveryApi['validateBackup']>(isFunction),
  getRecoveryStatus: z.custom<RecoveryApi['getRecoveryStatus']>(isFunction),
});
export type BackupEnvelope = z.output<typeof backupEnvelopeSchema>;
export type BackupListEnvelope = z.output<typeof backupListEnvelopeSchema>;
export type BackupValidationEnvelope = z.output<typeof backupValidationEnvelopeSchema>;

export interface RestoreInput {
  databasePath: string;
  lock: ReturnType<typeof acquireDatabaseLock>;
  backupDirectory: string;
  projectSlug: string;
  envelope: MutationEnvelope;
  actor: string;
  now?: () => number;
  failpoint?: (name: string) => void | Promise<void>;
}

export interface RestoreResult {
  database_epoch: string;
  affected_projects: string[];
  audit_ids: string[];
  recovery_snapshot_id: string;
}
