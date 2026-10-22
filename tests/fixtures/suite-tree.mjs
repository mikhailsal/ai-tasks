import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setInterval } from 'node:timers';
import { fileURLToPath } from 'node:url';

function identity(pid = process.pid) {
  const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1).split(' ');
  return { pid, startTime: fields[19] };
}
if (process.argv[2] === 'unrelated') {
  process.stdout.write(
    `${JSON.stringify({ type: 'ready', leader: identity(), descendant: identity() })}\n`,
  );
  setInterval(() => {}, 1000);
} else if (process.argv[2] === 'quick') {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'descendant'], {
    detached: true,
    stdio: 'ignore',
  });
  process.stdout.write(
    `${JSON.stringify({ type: 'ready', leader: identity(), descendant: identity(child.pid) })}\n`,
    () => process.exit(0),
  );
  child.unref();
} else if (process.argv[2] === 'descendant') {
  process.on('SIGTERM', () => {});
  process.stdout.write(`${JSON.stringify({ type: 'descendant', identity: identity() })}\n`);
  setInterval(() => {}, 1000);
} else {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'descendant'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
    if (!output.includes('\n')) return;
    const descendant = JSON.parse(output.trim()).identity;
    process.stdout.write(`${JSON.stringify({ type: 'ready', leader: identity(), descendant })}\n`);
  });
  process.on('SIGUSR1', () => process.exit(0));
}
