import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ai-tasks-browser-'));
const environment = {
  ...process.env,
  AI_TASKS_DB_PATH: join(temporaryDirectory, 'application.sqlite'),
  AI_TASKS_BACKUP_DIR: join(temporaryDirectory, 'backups'),
};
let server;
let shuttingDown = false;

try {
  const migration = spawn('npm', ['run', 'db:migrate'], {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit',
  });
  const migrationResult = await waitForExit(migration);
  if (migrationResult.code !== 0) {
    throw new Error(
      `Database migration command failed with exit code ${String(migrationResult.code)}`,
    );
  }

  server = spawn(process.execPath, ['dist/cli.js', 'serve', '--all-projects'], {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit',
  });
  process.on('SIGINT', () => stopServer('SIGINT'));
  process.on('SIGTERM', () => stopServer('SIGTERM'));
  const result = await waitForExit(server);
  process.exitCode = result.code ?? (result.signal === null ? 1 : 0);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Browser test server failed'}\n`,
  );
  process.exitCode = 1;
} finally {
  if (server !== undefined && server.exitCode === null && server.signalCode === null) {
    await stopServer('SIGTERM');
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function stopServer(signal) {
  if (
    shuttingDown ||
    server === undefined ||
    server.exitCode !== null ||
    server.signalCode !== null
  )
    return;
  shuttingDown = true;
  server.kill(signal);
  await Promise.race([
    waitForExit(server),
    new Promise((resolve) =>
      setTimeout(() => {
        server.kill('SIGKILL');
        resolve();
      }, 1_000),
    ),
  ]);
}
