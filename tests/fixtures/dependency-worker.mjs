import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const databasePath = process.argv[2];
const requests = JSON.parse(process.argv[3] ?? 'null');
const workerId = Number(process.env.AI_TASKS_WORKER_ID);
const request = requests?.[workerId];
if (!databasePath || !request) throw new Error('Missing dependency worker fixture request');
const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
let child;
process.on('message', (message) => {
  if (message?.type === 'shutdown') {
    child?.kill('SIGKILL');
    process.exit(0);
  }
  if (message?.type !== 'release' || child) return;
  child = spawn(
    process.execPath,
    [cli, 'dependency', 'add', request.taskId, '--project', request.slug, '--input', '-', '--json'],
    {
      env: { ...process.env, AI_TASKS_DB_PATH: databasePath },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.on('error', (error) => {
    stderr += error.message;
  });
  child.on('close', (exitCode, signal) => {
    clearTimeout(timer);
    process.send?.({
      type: 'result',
      workerId,
      workerPid: process.pid,
      cliPid: child.pid,
      exitCode,
      signal,
      stdout,
      stderr,
    });
  });
  const { payload, ...guards } = request.input;
  child.stdin.end(JSON.stringify({ ...guards, ...payload }));
});
process.send?.({ type: 'ready', workerId, pid: process.pid });
