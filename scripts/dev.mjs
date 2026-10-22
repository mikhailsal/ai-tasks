import { spawn } from 'node:child_process';

const children = [
  spawn(
    process.execPath,
    ['node_modules/tsup/dist/cli-default.js', '--watch', '--onSuccess', 'node dist/api.js'],
    {
      stdio: 'inherit',
      detached: true,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        AI_TASKS_DEV_ORIGIN: 'http://127.0.0.1:5173',
      },
    },
  ),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'web/vite.config.ts'], {
    stdio: 'inherit',
    detached: true,
  }),
];
let stopping = false;
function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (!child.pid) continue;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}
for (const child of children) {
  child.once('error', () => stop(1));
  child.once('exit', (code) => stop(code ?? 1));
}
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
