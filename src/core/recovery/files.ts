import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { uuidSchema } from '../../schema/values.js';
import { domainError, normalizeError } from '../errors.js';

export function missingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
export function backupDirectory(databasePath: string, selected?: string): string {
  return resolve(selected ?? join(dirname(databasePath), 'backups'));
}
export function managedPath(
  directory: string,
  collection: 'snapshots' | 'receipts' | 'jobs',
  id: string,
  extension = 'json',
): string {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success)
    throw domainError('VALIDATION_ERROR', 'A managed recovery ID must be a UUID');
  return join(directory, collection, `${parsed.data}.${extension}`);
}
export async function ensureManagedDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw domainError('INTERNAL_ERROR', 'Managed recovery storage is unavailable');
}
export async function verifyManagedFile(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
    throw domainError('INTERNAL_ERROR', 'Managed recovery artifact is invalid');
  return info;
}
export async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function syncFile(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
/** Same-directory temporary writes are synced before atomic publication. */
export async function publishJson(path: string, value: unknown, replace = false): Promise<boolean> {
  const directory = dirname(path);
  await ensureManagedDirectory(directory);
  const temporary = join(directory, `.${randomUUID()}.partial`);
  try {
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (replace) await rename(temporary, path);
    else {
      try {
        await link(temporary, path);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false;
        throw error;
      }
      await rm(temporary);
    }
    await syncDirectory(directory);
    return true;
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function readJson(path: string): Promise<unknown> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw domainError('INTERNAL_ERROR', 'Managed recovery manifest is invalid');
    const source = await handle.readFile('utf8');
    return JSON.parse(source);
  } catch (error) {
    throw normalizeError(error);
  } finally {
    await handle.close();
  }
}
export async function fileChecksum(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1)
      throw domainError('INTERNAL_ERROR', 'Managed recovery artifact is invalid');
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      const bytes: unknown = chunk;
      if (!Buffer.isBuffer(bytes))
        throw domainError('INTERNAL_ERROR', 'The snapshot could not be read');
      hash.update(bytes);
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}
export async function canonicalManagedDirectory(directory: string): Promise<string> {
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw domainError('INTERNAL_ERROR', 'Managed recovery storage is unavailable');
    return await realpath(directory);
  } catch (error) {
    if (missingFile(error)) return resolve(directory);
    throw normalizeError(error);
  }
}

export async function recoveryCollection(
  directory: string,
  collection: 'snapshots' | 'receipts' | 'jobs',
  create = false,
): Promise<string> {
  if (create) await ensureManagedDirectory(directory);
  else await canonicalManagedDirectory(directory);
  const target = join(directory, collection);
  if (create) await ensureManagedDirectory(target);
  else await canonicalManagedDirectory(target);
  return target;
}
