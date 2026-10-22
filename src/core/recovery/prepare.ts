import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod/mini';
import type { MutationEnvelope } from '../../schema/envelopes.js';
import { actorSchema, createContext } from '../context.js';
import { refuseUnresolvedRecovery, type ConnectionLock } from '../database/lock-check.js';
import { migrateDatabase } from '../database/migrate.js';
import type { DatabaseConnection } from '../database/types.js';
import { domainError, normalizeError } from '../errors.js';
import { queryMetadata, queryState } from '../queries/page.js';
import { readClock } from '../time.js';
import { parseInput } from '../validation.js';
import { createBackup } from './backup.js';
import { openRecoveryConnection, recoveryStagePath, verifyRecoveryLock } from './connections.js';
import { backupDirectory, fileChecksum, syncDirectory, syncFile } from './files.js';
import { backupSnapshotPath } from './manifests.js';
import { validateRestore } from './preconditions.js';
import { finalizeSnapshot, verifiedSnapshot, verifySnapshot } from './snapshot.js';
import { stageRestore } from './stage.js';

export type RecoveryFailpoint = (name: string) => void | Promise<void>;
export type RestoreOptions = {
  databasePath: string;
  lock: ConnectionLock;
  backupDirectory?: string;
  projectSlug: string;
  envelope: MutationEnvelope;
  actor: string;
  now?: () => number;
  failpoint?: RecoveryFailpoint;
};

const checkpointSchema = z.array(
  z.strictObject({ busy: z.int(), log: z.int(), checkpointed: z.int() }),
);
function checkpoint(connection: DatabaseConnection): void {
  const result = checkpointSchema.parse(connection.sqlite.pragma('wal_checkpoint(TRUNCATE)'));
  if (result.length !== 1 || result[0]?.busy !== 0)
    throw domainError('DB_CONFLICT', 'The live database could not finish its checkpoint');
}

async function copyStage(
  directory: string,
  validated: Awaited<ReturnType<typeof validateRestore>>,
  path: string,
) {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  await handle.close();
  try {
    const sqlite = await verifiedSnapshot(
      backupSnapshotPath({ backupDirectory: directory, backupId: validated.input.backup_id }),
      validated.validation.data.backup,
    );
    try {
      await sqlite.backup(path);
    } finally {
      sqlite.close();
    }
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  }
}

async function inspectCurrent(options: RestoreOptions, path: string, now: () => number) {
  const connection = openRecoveryConnection({
    databasePath: path,
    lock: options.lock,
    role: 'read-live',
    now,
  });
  try {
    const context = createContext({
      connection,
      actor: parseInput(actorSchema, options.actor),
      now,
    });
    verifySnapshot(connection.sqlite);
    return await validateRestore(context, options.projectSlug, options.envelope, {
      backupDirectory: backupDirectory(path, options.backupDirectory),
    });
  } finally {
    connection.close();
  }
}

async function buildStage(input: {
  options: RestoreOptions & { jobId: string };
  validated: Awaited<ReturnType<typeof validateRestore>>;
  live: DatabaseConnection;
  directory: string;
  now: () => number;
}) {
  const { options, validated, live, directory, now } = input;
  const path = recoveryStagePath(options.databasePath, options.jobId);
  const context = createContext({
    connection: live,
    actor: parseInput(actorSchema, options.actor),
    now,
  });
  const recovery = await createBackup(
    context,
    options.projectSlug,
    {
      ...validated.request.input,
      operation_id: randomUUID(),
      payload: {},
    },
    { backupDirectory: directory },
  );
  await options.failpoint?.('recovery.after_sync');
  await copyStage(directory, validated, path);
  let complete = false;
  try {
    const stage = openRecoveryConnection({
      databasePath: options.databasePath,
      lock: options.lock,
      role: 'stage',
      jobId: options.jobId,
      now,
    });
    let result;
    let meta;
    try {
      migrateDatabase(stage);
      result = stageRestore({
        live,
        stage,
        backup: validated.validation.data.backup,
        context: createContext({ connection: stage, actor: context.actor, now }),
        operationId: validated.request.input.operation_id,
        confirmation: validated.confirmation,
        affectedProjects: validated.validation.data.affected_projects,
        newEpoch: randomUUID(),
        recoverySnapshotId: recovery.data.id,
        now: now(),
      });
      meta = stage.db.transaction((transaction) => queryMetadata(queryState(transaction), now()));
    } finally {
      stage.close();
    }
    finalizeSnapshot(path);
    await options.failpoint?.('stage.before_sync');
    await syncFile(path);
    await options.failpoint?.('stage.after_sync');
    await syncDirectory(dirname(path));
    checkpoint(live);
    const stageChecksum = await fileChecksum(path);
    complete = true;
    return { stagePath: path, stageChecksum, result, meta, recovery: recovery.data };
  } finally {
    if (!complete) await rm(path, { force: true });
  }
}

/** Produces closed, verified files only. Publication and its phase guard are a separate step. */
export async function prepareRestore(options: RestoreOptions & { jobId: string }) {
  try {
    const path = verifyRecoveryLock(options.databasePath, options.lock);
    refuseUnresolvedRecovery(path);
    const now = () => readClock(options.now ?? Date.now);
    const validated = await inspectCurrent(options, path, now);
    const connection = openRecoveryConnection({
      databasePath: path,
      lock: options.lock,
      role: 'write-live',
      now,
    });
    try {
      return {
        ...(await buildStage({
          options: { ...options, databasePath: path },
          validated,
          live: connection,
          directory: backupDirectory(path, options.backupDirectory),
          now,
        })),
        identity: validated.request.identity,
        previousMeta: validated.request.meta,
      };
    } finally {
      connection.close();
    }
  } catch (error) {
    throw normalizeError(error);
  }
}

export type PreparedRestore = Awaited<ReturnType<typeof prepareRestore>>;
