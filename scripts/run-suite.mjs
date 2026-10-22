import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setInterval, clearInterval } from 'node:timers';
import { setTimeout as pause } from 'node:timers/promises';

const budgets = { functional: 180_000, contention: 180_000, browser: 600_000, benchmark: 300_000 };
const [suite, separator, command, ...args] = process.argv.slice(2);
if (!Object.hasOwn(budgets, suite ?? '') || separator !== '--' || !command) {
  process.stderr.write(
    'Usage: node scripts/run-suite.mjs <functional|contention|browser|benchmark> -- <command> [args...]\n',
  );
  process.exit(2);
}

const startedAt = new Date().toISOString();
const start = performance.now();
// Each nested runner gets a distinct owner. Detached/orphaned children retain the
// marker even after their original parent disappears between process-tree polls.
const ownerKey = 'AI_TASKS_SUITE_OWNER';
const ownerEntry = `${ownerKey}=${randomUUID()}`;
const child = spawn(command, args, {
  stdio: 'inherit',
  detached: true,
  env: { ...process.env, [ownerKey]: ownerEntry.slice(ownerKey.length + 1) },
});
const identities = new Map();
let timedOut = false;
let spawnError;
let cleanupError;
let killTimer;
let terminating = false;

function identity(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat
      .slice(stat.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/u);
    return { pid, startTime: fields[19], group: Number(fields[2]), state: fields[0] };
  } catch {
    return undefined;
  }
}
function sameProcess(expected, current) {
  return current && current.startTime === expected.startTime;
}
function live(expected) {
  const current = identity(expected.pid);
  return sameProcess(expected, current) && current.state !== 'Z' && current.state !== 'X';
}
function remember(current) {
  if (current) identities.set(current.pid, current);
}
remember(child.pid ? identity(child.pid) : undefined);
const runnerGroup = identity(process.pid)?.group;

function captureChildren() {
  // Dead identities cannot reveal descendants or safely hold a process group.
  // Surviving tagged orphans are still recovered by captureTaggedOrphans.
  for (const expected of identities.values()) {
    if (!live(expected)) identities.delete(expected.pid);
  }
  const queue = [...identities.values()];
  const visited = new Set();
  for (const parent of queue) {
    const key = `${parent.pid}:${parent.startTime}`;
    if (visited.has(key) || !live(parent)) continue;
    visited.add(key);
    try {
      const children = readFileSync(`/proc/${parent.pid}/task/${parent.pid}/children`, 'utf8');
      if (!sameProcess(parent, identity(parent.pid))) continue;
      for (const text of children.trim().split(/\s+/u)) {
        if (!/^\d+$/u.test(text)) continue;
        const descendant = identity(Number(text));
        if (!descendant) continue;
        remember(descendant);
        queue.push(descendant);
      }
    } catch {
      /* An exiting process has no remaining children file. */
    }
  }
}
function captureTaggedOrphans() {
  // Read ownership privately; never log process environments or the owner token.
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/u.test(entry)) continue;
    const current = identity(Number(entry));
    if (!current || current.state === 'Z') continue;
    try {
      const environment = readFileSync(`/proc/${entry}/environ`, 'utf8');
      if (
        environment.split('\0').includes(ownerEntry) &&
        sameProcess(current, identity(current.pid))
      )
        remember(current);
    } catch {
      /* Unrelated, inaccessible, or already-exited processes are ignored. */
    }
  }
}
function captureOwned() {
  captureChildren();
  captureTaggedOrphans();
  captureChildren();
}
function signalOwned(signal) {
  const groups = new Set();
  for (const expected of identities.values()) {
    const current = identity(expected.pid);
    if (!sameProcess(expected, current) || current.state === 'Z' || current.state === 'X') continue;
    if (current.group > 0 && current.group !== runnerGroup) groups.add(current.group);
  }
  for (const group of groups) {
    // A live, start-time-verified owner must still hold this group before signaling;
    // never reuse an old numeric PGID after its original processes have disappeared.
    const held = [...identities.values()].some((expected) => {
      const current = identity(expected.pid);
      return (
        sameProcess(expected, current) &&
        current.group === group &&
        current.state !== 'Z' &&
        current.state !== 'X'
      );
    });
    if (!held) continue;
    try {
      process.kill(-group, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') cleanupError = 'PROCESS_SIGNAL_FAILED';
    }
  }
}
function terminate() {
  // Capture synchronously before terminating the leader, which can orphan servers.
  captureOwned();
  if (terminating) return;
  terminating = true;
  signalOwned('SIGTERM');
  killTimer = setTimeout(() => {
    captureOwned();
    signalOwned('SIGKILL');
  }, 1000);
}
async function cleanupOwned() {
  captureOwned();
  signalOwned('SIGTERM');
  const graceDeadline = performance.now() + 1000;
  while ([...identities.values()].some(live) && performance.now() < graceDeadline) {
    await pause(25);
    captureChildren();
  }
  captureOwned();
  signalOwned('SIGKILL');
  const killDeadline = performance.now() + 500;
  while ([...identities.values()].some(live) && performance.now() < killDeadline) {
    await pause(10);
    captureOwned();
    signalOwned('SIGKILL');
  }
  if ([...identities.values()].some(live)) cleanupError = 'DESCENDANTS_SURVIVED';
}
const watcher = setInterval(captureChildren, 100);
watcher.unref();
const timer = setTimeout(() => {
  timedOut = true;
  terminate();
}, budgets[suite]);
const onInterrupt = () => terminate();
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onInterrupt);
child.once('error', (error) => {
  spawnError = error.code ?? 'SPAWN_ERROR';
});
child.once('close', async (code, signal) => {
  await cleanupOwned();
  clearTimeout(timer);
  clearTimeout(killTimer);
  clearInterval(watcher);
  process.off('SIGINT', onInterrupt);
  process.off('SIGTERM', onInterrupt);
  const evidence = {
    suite,
    command: [command, ...args],
    started_at: startedAt,
    duration_ms: Math.round(performance.now() - start),
    budget_ms: budgets[suite],
    exit_code: timedOut ? 124 : cleanupError ? 1 : (code ?? 1),
    signal,
    timed_out: timedOut,
    ...(spawnError ? { spawn_error: spawnError } : {}),
    ...(cleanupError ? { cleanup_error: cleanupError } : {}),
    node: process.versions.node,
    platform: process.platform,
  };
  try {
    await mkdir('artifacts/checks', { recursive: true });
    await writeFile(
      `artifacts/checks/${startedAt.replaceAll(':', '-')}-${suite}.json`,
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  } catch {
    process.stderr.write('Could not save check evidence\n');
    evidence.exit_code = 1;
  }
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  process.exitCode = evidence.exit_code;
});
