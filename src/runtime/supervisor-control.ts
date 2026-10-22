import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import net, { type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  supervisorControlFailure,
  supervisorControlRequestSchema,
  supervisorControlResponseSchema,
  supervisorControlError,
  SUPERVISOR_CONTROL_FRAME_BYTES,
  type SupervisorControlRequest,
  type SupervisorControlResponse,
  type SupervisorRecoveryJobEnvelope,
  type SupervisorRestoreSubmission,
} from '../core/recovery/control.js';
import {
  acquireDatabaseLock,
  canonicalDatabasePath,
  releaseDatabaseLock,
} from './database-lock.js';

const maxFrameBytes = SUPERVISOR_CONTROL_FRAME_BYTES;
const socketTimeoutMs = 30_000;
const uid = typeof process.getuid === 'function' ? process.getuid() : 0;

export function supervisorMutexDatabasePath(databasePath: string): string {
  return canonicalDatabasePath(databasePath) + '.supervisor';
}

export function supervisorSocketPath(databasePath: string): string {
  const canonical = canonicalDatabasePath(databasePath);
  const digest = createHash('sha256')
    .update(canonical)
    .update('\0')
    .update(String(uid))
    .digest('hex');
  const parent = join(tmpdir(), 'ai-tasks-supervisor-' + String(uid));
  const socketPath = join(parent, digest.slice(0, 32) + '.sock');
  if (Buffer.byteLength(socketPath) >= 100)
    throw new Error('Supervisor control socket path is too long');
  return socketPath;
}

async function privateSocketDirectory(create: boolean): Promise<string> {
  const parent = join(tmpdir(), 'ai-tasks-supervisor-' + String(uid));
  if (create) await mkdir(parent, { recursive: true, mode: 0o700 });
  let info;
  try {
    info = await lstat(parent);
  } catch (error) {
    if (!create && error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return parent;
    throw error;
  }
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== uid ||
    (info.mode & 0o777) !== 0o700
  )
    throw new Error('Supervisor control directory is unsafe');
  return parent;
}

async function inspectSocket(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isSocket() || info.isSymbolicLink() || info.uid !== uid)
      throw new Error('Supervisor control endpoint is unsafe');
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function reply(socket: Socket, response: SupervisorControlResponse): void {
  if (socket.destroyed) return;
  let validated = supervisorControlResponseSchema.parse(response);
  let frame = Buffer.from(JSON.stringify(validated) + '\n');
  if (frame.byteLength > maxFrameBytes) {
    validated = supervisorControlFailure(new Error('Supervisor response is too large'));
    frame = Buffer.from(JSON.stringify(validated) + '\n');
  }
  socket.end(frame);
}

function installHandler(
  server: Server,
  submitRestore: (input: SupervisorRestoreSubmission) => Promise<SupervisorRecoveryJobEnvelope>,
): () => void {
  let activeConnections = 0;
  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    activeConnections += 1;
    socket.once('close', () => {
      sockets.delete(socket);
      activeConnections -= 1;
    });
    if (activeConnections > 32) {
      socket.destroy();
      return;
    }
    socket.setTimeout(socketTimeoutMs, () => socket.destroy());
    const chunks: Buffer[] = [];
    let bytes = 0;
    let oversized = false;
    socket.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > maxFrameBytes) {
        oversized = true;
        socket.destroy();
        return;
      }
      chunks.push(chunk);
    });
    socket.on('end', async () => {
      if (oversized) return;
      try {
        const frame = Buffer.concat(chunks);
        if (
          frame.length < 2 ||
          frame[frame.length - 1] !== 0x0a ||
          frame.subarray(0, -1).includes(0x0a)
        )
          throw new Error('Invalid supervisor request frame');
        const source = new TextDecoder('utf-8', { fatal: true }).decode(frame.subarray(0, -1));
        const parsed = supervisorControlRequestSchema.parse(JSON.parse(source));
        const result = await submitRestore({
          projectSlug: parsed.projectSlug,
          envelope: parsed.envelope,
          caller: 'cli',
        });
        if (result.data.operation_id !== parsed.envelope.operation_id)
          throw new Error('Supervisor returned a job for another operation');
        reply(socket, supervisorControlResponseSchema.parse({ ok: true, result }));
      } catch (error) {
        reply(socket, supervisorControlFailure(error));
      }
    });
    socket.on('error', () => {});
  });
  return () => {
    for (const socket of sockets) socket.destroy();
  };
}

export async function startSupervisorControl(options: {
  databasePath: string;
  submitRestore(input: SupervisorRestoreSubmission): Promise<SupervisorRecoveryJobEnvelope>;
}): Promise<{ socketPath: string; close(): Promise<void> }> {
  const databasePath = canonicalDatabasePath(options.databasePath);
  const socketPath = supervisorSocketPath(databasePath);
  const mutexPath = supervisorMutexDatabasePath(databasePath);
  const lock = acquireDatabaseLock({
    databasePath: mutexPath,
    mode: 'exclusive',
    timeoutSeconds: 0,
  });
  let server: Server | undefined;
  let closeConnections = () => {};
  let closed = false;
  try {
    await privateSocketDirectory(true);
    if (await inspectSocket(socketPath)) await unlink(socketPath);
    server = net.createServer({ allowHalfOpen: true });
    closeConnections = installHandler(server, options.submitRestore);
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server?.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server?.off('error', onError);
        resolve();
      };
      server?.once('error', onError);
      server?.once('listening', onListening);
      server?.listen(socketPath);
    });
    await chmod(socketPath, 0o600);
    const info = await lstat(socketPath);
    if (!info.isSocket() || info.uid !== uid || (info.mode & 0o777) !== 0o600)
      throw new Error('Supervisor control socket could not be secured');
    return {
      socketPath,
      async close() {
        if (closed) return;
        closed = true;
        try {
          const closing = new Promise<void>((resolve, reject) => {
            server?.close((error) => (error ? reject(error) : resolve()));
          });
          closeConnections();
          await closing;
          if (await inspectSocket(socketPath)) await unlink(socketPath);
        } finally {
          releaseDatabaseLock(lock);
        }
      },
    };
  } catch (error) {
    try {
      if (server?.listening) {
        const closing = new Promise<void>((resolve) => server?.close(() => resolve()));
        closeConnections();
        await closing;
      }
      if (await inspectSocket(socketPath)) await unlink(socketPath);
    } finally {
      releaseDatabaseLock(lock);
    }
    throw error;
  }
}

function socketUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    ['ENOENT', 'ECONNREFUSED', 'ENOTSOCK'].includes(String(error.code))
  );
}

async function requestSupervisor(
  path: string,
  request: SupervisorControlRequest,
): Promise<SupervisorRecoveryJobEnvelope> {
  return await new Promise<SupervisorRecoveryJobEnvelope>((resolve, reject) => {
    const requestBytes = Buffer.from(JSON.stringify(request) + '\n');
    if (requestBytes.byteLength > maxFrameBytes) {
      reject(new Error('Supervisor request is too large'));
      return;
    }
    const socket = net.createConnection(path);
    let settled = false;
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(
      () => socket.destroy(new Error('Supervisor request timed out')),
      socketTimeoutMs,
    );
    const finish = (error?: Error, result?: SupervisorRecoveryJobEnvelope) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new Error('Invalid supervisor response'));
    };
    socket.on('connect', () => {
      socket.end(requestBytes);
    });
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.byteLength > maxFrameBytes) finish(new Error('Supervisor response is too large'));
    });
    socket.on('end', () => {
      try {
        if (
          buffer.length < 2 ||
          buffer[buffer.length - 1] !== 0x0a ||
          buffer.subarray(0, -1).includes(0x0a)
        )
          throw new Error('Invalid supervisor response frame');
        const source = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, -1));
        const response = supervisorControlResponseSchema.parse(JSON.parse(source));
        if (!response.ok) {
          throw supervisorControlError(
            response.error.code,
            response.error.details,
            response.error.message,
          );
        }
        if (response.result.data.operation_id !== request.envelope.operation_id)
          throw new Error('Supervisor returned a job for another operation');
        finish(undefined, response.result);
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Invalid supervisor response'));
      }
    });
    socket.on('error', (error) => finish(error));
    socket.on('close', () => {
      if (!settled) finish(new Error('Supervisor connection closed without a response'));
    });
  });
}

export async function coordinateRestore(options: {
  databasePath: string;
  projectSlug: string;
  envelope: SupervisorControlRequest['envelope'];
  startStandalone(): Promise<SupervisorRecoveryJobEnvelope>;
}): Promise<SupervisorRecoveryJobEnvelope> {
  const canonical = canonicalDatabasePath(options.databasePath);
  const socketPath = supervisorSocketPath(canonical);
  const request = supervisorControlRequestSchema.parse({
    version: 1,
    type: 'restore',
    projectSlug: options.projectSlug,
    envelope: options.envelope,
  });
  await privateSocketDirectory(false);
  if (await inspectSocket(socketPath)) {
    try {
      return await requestSupervisor(socketPath, request);
    } catch (error) {
      if (!socketUnavailable(error)) throw error;
    }
  }
  let lock;
  try {
    lock = acquireDatabaseLock({
      databasePath: supervisorMutexDatabasePath(canonical),
      mode: 'exclusive',
      timeoutSeconds: 0,
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'DB_CONFLICT')
      throw supervisorControlError('MAINTENANCE');
    throw error;
  }
  try {
    const result = supervisorControlResponseSchema.parse({
      ok: true,
      result: await options.startStandalone(),
    });
    if (result.ok !== true || result.result.data.operation_id !== request.envelope.operation_id)
      throw new Error('Standalone restore returned a job for another operation');
    return result.result;
  } finally {
    releaseDatabaseLock(lock);
  }
}
