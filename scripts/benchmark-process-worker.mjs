import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

// Literal, distinct RGI markers, disjoint from the benchmark fixture's smiley projects.
const writerMarkers = [
  '🦁',
  '🐯',
  '🐻',
  '🐼',
  '🐨',
  '🐸',
  '🐵',
  '🐔',
  '🐧',
  '🐦',
  '🐤',
  '🦆',
  '🦅',
  '🦉',
  '🦇',
  '🐺',
  '🐗',
  '🐴',
  '🦄',
  '🐝',
  '🐛',
  '🦋',
  '🐌',
  '🐞',
  '🐜',
  '🪲',
  '🦗',
  '🕷️',
  '🦂',
  '🐢',
  '🐍',
  '🦎',
  '🦖',
  '🦕',
  '🐙',
  '🦑',
  '🦐',
  '🦞',
  '🦀',
  '🐡',
];
const mode = process.argv[2];
const index = Number(process.env.AI_TASKS_BENCH_INDEX);
const databasePath = process.env.AI_TASKS_DB_PATH;
const inputDirectory = process.env.AI_TASKS_BENCH_INPUT_DIR;
const cli = resolve('dist/cli.js');
const environment = { ...process.env, NO_COLOR: '1', TERM: 'dumb' };
delete environment.FORCE_COLOR;

function command(args) {
  const started = performance.now();
  const result = spawnSync(process.execPath, [cli, ...args], {
    env: environment,
    encoding: 'utf8',
    timeout: 20_000,
    killSignal: 'SIGKILL',
    maxBuffer: 8_000_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const duration_ms = performance.now() - started;
  if (result.error || result.signal || result.status === null)
    throw new Error(`CLI process failed: ${result.error?.message ?? result.signal ?? 'no status'}`);
  const source = result.status === 0 ? result.stdout : result.stderr;
  if (!source.trim() || (result.status === 0 ? result.stderr : result.stdout).trim())
    throw new Error(`CLI violated JSON stream contract (exit ${result.status})`);
  const envelope = JSON.parse(source);
  if (envelope === null || typeof envelope !== 'object' || envelope.ok !== (result.status === 0))
    throw new Error(`CLI returned an invalid response (exit ${result.status})`);
  return { status: result.status, duration_ms, envelope };
}
async function send(message) {
  await new Promise((resolvePromise, reject) => {
    if (!process.send || !process.connected)
      return reject(new Error('Benchmark parent IPC unavailable'));
    process.send(message, (error) => (error ? reject(error) : resolvePromise()));
  });
}
function barrier() {
  let cancel = () => {};
  const wait = new Promise((resolvePromise, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      process.off('message', message);
      process.off('disconnect', disconnected);
    };
    cancel = cleanup;
    const message = (value) => {
      if (
        value === null ||
        typeof value !== 'object' ||
        Reflect.ownKeys(value).length !== 1 ||
        value.type !== 'go'
      ) {
        cleanup();
        reject(new Error('Invalid benchmark barrier message'));
        return;
      }
      cleanup();
      resolvePromise();
    };
    const disconnected = () => {
      cleanup();
      reject(new Error('Benchmark parent disconnected before barrier'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Benchmark start barrier deadline exceeded'));
    }, 60_000);
    process.on('message', message);
    process.on('disconnect', disconnected);
  });
  // Observe early disconnects even while the readiness acknowledgment is in flight.
  void wait.catch(() => {});
  return { wait, cancel };
}
function epochFromControl(response) {
  const epoch = response.envelope.data?.database_epoch;
  if (
    response.status !== 0 ||
    typeof epoch !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(epoch) ||
    response.envelope.meta?.database_epoch !== epoch
  )
    throw new Error('Production CLI metadata did not return the current epoch');
  return epoch;
}
async function writerInputs(epoch) {
  const info = await lstat(inputDirectory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('Benchmark input directory is invalid');
  const prefix = `bench-${index}-${randomUUID().slice(0, 8)}`;
  const directory = join(inputDirectory, prefix);
  await mkdir(directory, { mode: 0o700 });
  const inputs = [];
  for (let mutation = 0; mutation < 10; mutation += 1) {
    const emoji = writerMarkers[index * 10 + mutation];
    if (emoji === undefined) throw new Error('Missing literal writer marker');
    const slug = `${prefix}-${mutation}`;
    const input = {
      operation_id: randomUUID(),
      database_epoch: epoch,
      payload: { slug, name: `Benchmark writer ${index}/${mutation}`, emoji },
    };
    // CLI input files use its documented flattened payload plus operation guards.
    const path = join(directory, `${mutation}.json`);
    await writeFile(
      path,
      JSON.stringify({
        ...input.payload,
        operation_id: input.operation_id,
        database_epoch: input.database_epoch,
      }),
      { flag: 'wx', mode: 0o600 },
    );
    inputs.push({ slug, path, operationId: input.operation_id });
  }
  return inputs;
}
function writerCall(input) {
  const response = command([
    'project',
    'create',
    '--project',
    input.slug,
    '--input',
    input.path,
    '--json',
  ]);
  if (
    response.status === 0 &&
    (response.envelope.data?.slug !== input.slug ||
      response.envelope.meta?.operation_id !== input.operationId)
  )
    throw new Error('Production writer returned a different mutation identity');
  return {
    status: response.status,
    duration_ms: response.duration_ms,
    rows: response.status === 0 ? 1 : 0,
    ...(response.status === 0 ? {} : { error: response.envelope.error }),
  };
}
function readerCall() {
  const response = command(['task', 'list', '--all-projects', '--limit', '200', '--json']);
  const items = response.envelope.data?.items;
  if (response.status === 0 && (!Array.isArray(items) || items.length === 0))
    throw new Error('Production reader returned no materialized tasks');
  return {
    status: response.status,
    duration_ms: response.duration_ms,
    rows: Array.isArray(items) ? items.length : 0,
    ...(response.status === 0 ? {} : { error: response.envelope.error }),
  };
}

let cancelBarrier = () => {};
const calls = [];
const setupCalls = [];
try {
  if (
    !process.send ||
    !databasePath ||
    !inputDirectory ||
    !['writer', 'reader'].includes(mode) ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= (mode === 'writer' ? 4 : 20)
  )
    throw new Error(
      'Benchmark worker requires mode, index, database, input directory and private IPC',
    );
  const control = command(['meta', '--all-projects', '--json']);
  setupCalls.push({ operation: 'meta', status: control.status, duration_ms: control.duration_ms });
  const epoch = epochFromControl(control);
  const inputs = mode === 'writer' ? await writerInputs(epoch) : [];
  // Install the barrier before readiness so an immediately responding parent cannot race it.
  const go = barrier();
  cancelBarrier = go.cancel;
  await send({ type: 'ready', mode, index });
  await go.wait;
  const started = performance.now();
  if (mode === 'writer') for (const input of inputs) calls.push(writerCall(input));
  else calls.push(readerCall());
  await send({
    type: 'result',
    mode,
    index,
    calls,
    rows: calls.reduce((sum, call) => sum + call.rows, 0),
    setup_calls: setupCalls,
    total_duration_ms: performance.now() - started,
  });
  if (calls.some((call) => call.status !== 0)) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : 'Benchmark worker failed';
  process.stderr.write(`${message}\n`);
  try {
    await send({ type: 'error', mode, index, message, calls, setup_calls: setupCalls });
  } catch {
    /* Parent already owns the deadline diagnostic. */
  }
  process.exitCode = 1;
} finally {
  cancelBarrier();
  if (process.connected) process.disconnect();
}
