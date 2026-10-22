import { fork, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { availableParallelism, cpus, freemem, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const out = resolve('artifacts/benchmarks');
await mkdir(out, { recursive: true });
const started = new Date().toISOString();
const startedAt = performance.now();
const temp = await mkdtemp(join('/tmp', 'ai-tasks-benchmark-'));
const dbPath = join(temp, 'benchmark.sqlite');
const env = {
  ...process.env,
  NO_COLOR: '1',
  TERM: 'dumb',
  AI_TASKS_DB_PATH: dbPath,
  AI_TASKS_BACKUP_DIR: join(temp, 'backups'),
};
delete env.FORCE_COLOR;
const report = { started_at: started, status: 'running', environment: environment(), phases: {} };
const cli = resolve('dist/cli.js');
const migrate = resolve('dist/migrate.js');
const inputDirectory = join(temp, 'inputs');
await mkdir(inputDirectory, { recursive: true });

function environment() {
  const result = spawnSync(
    'bash',
    ['-lc', 'uname -srmo; lsblk -ndo NAME,ROTA,TYPE,MOUNTPOINT | head -12; df -T /tmp'],
    { encoding: 'utf8' },
  );
  let sqlite;
  try {
    sqlite = new Database(':memory:').prepare('select sqlite_version() as version').get().version;
  } catch (error) {
    sqlite = error instanceof Error ? `unavailable: ${error.message}` : 'unavailable';
  }
  return {
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    cpu_count: availableParallelism(),
    cpu_model: cpus()[0]?.model ?? 'unknown',
    memory_total_bytes: totalmem(),
    memory_free_bytes_at_start: freemem(),
    sqlite: sqlite ?? 'unavailable',
    filesystem_probe: result.stdout.trim(),
    reference_profile: '4 vCPU, 8 GiB RAM, local SSD; current host may differ',
  };
}
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}
function summarize(values) {
  return {
    samples: values.length,
    p50_ms: percentile(values, 50),
    p95_ms: percentile(values, 95),
    max_ms: Math.max(...values, 0),
  };
}
function timedSpawn(command, args, options = {}) {
  const start = performance.now();
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 2_000_000,
    ...options,
  });
  return {
    duration: performance.now() - start,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error?.message,
  };
}
try {
  if (!(await exists(cli)) || !(await exists(migrate)))
    throw new Error('Run the production server build before npm run bench');
  const migration = timedSpawn(process.execPath, [migrate], { env });
  if (migration.status !== 0) throw new Error(`Production migration failed: ${migration.stderr}`);
  const fixturePath = pathToFileURL(resolve('tests/fixtures/benchmark-data.ts'));
  const { seedBenchmarkData, standardBenchmarkSize } = await import(fixturePath.href);
  const sqlite = new Database(dbPath);
  try {
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('journal_mode = WAL');
    const seeded = seedBenchmarkData(sqlite, standardBenchmarkSize);
    const foreignKeyProblems = sqlite.pragma('foreign_key_check');
    if (foreignKeyProblems.length) throw new Error('Benchmark fixture violates foreign keys');
    verifySeedCounts(sqlite, seeded);
    report.phases.seed = {
      counts: seeded,
      foreign_key_violations: foreignKeyProblems.length,
      integrity_check: sqlite.pragma('integrity_check'),
    };
  } finally {
    sqlite.close();
  }
  const diagnosticPath = join(temp, 'diagnostic.sqlite');
  const diagnosticMigration = timedSpawn(process.execPath, [migrate], {
    env: { ...env, AI_TASKS_DB_PATH: diagnosticPath },
  });
  if (diagnosticMigration.status !== 0)
    throw new Error(`Diagnostic migration failed: ${diagnosticMigration.stderr}`);
  const { diagnosticBenchmarkSize } = await import(fixturePath.href);
  const diagnostic = new Database(diagnosticPath);
  try {
    diagnostic.pragma('foreign_keys = ON');
    diagnostic.pragma('journal_mode = WAL');
    const seeded = seedBenchmarkData(diagnostic, diagnosticBenchmarkSize);
    const foreignKeyProblems = diagnostic.pragma('foreign_key_check');
    if (foreignKeyProblems.length) throw new Error('Diagnostic fixture violates foreign keys');
    verifySeedCounts(diagnostic, seeded);
    report.phases.diagnostic_seed = {
      counts: seeded,
      foreign_key_violations: foreignKeyProblems.length,
      integrity_check: diagnostic.pragma('integrity_check'),
      measurement_role: 'independent diagnostic fixture; measured separately below',
    };
  } finally {
    diagnostic.close();
  }

  const cliSamples = [];
  for (let i = 0; i < 100; i += 1) {
    const result = timedSpawn(
      process.execPath,
      [cli, 'project', 'list', '--all-projects', '--json'],
      { env },
    );
    if (result.status !== 0 || result.stderr.trim())
      throw new Error(`Cold CLI sample ${i + 1} failed: ${result.stderr}`);
    const envelope = JSON.parse(result.stdout);
    if (envelope?.ok !== true || envelope?.data?.items?.length !== 20)
      throw new Error(`Cold CLI sample ${i + 1} returned an invalid materialized response`);
    cliSamples.push(result.duration);
  }
  report.phases.cold_cli_100 = summarize(cliSamples);

  const queryBuild = timedSpawn(
    process.execPath,
    [
      'node_modules/tsup/dist/cli-default.js',
      'scripts/benchmark-query.ts',
      '--out-dir',
      join(temp, 'query-helper'),
      '--format',
      'esm',
      '--platform',
      'node',
      '--target',
      'node24',
      '--external',
      'better-sqlite3',
      '--no-splitting',
      '--clean',
      '--no-config',
    ],
    { env: process.env },
  );
  if (queryBuild.status !== 0)
    throw new Error(`Core query harness compile failed: ${queryBuild.stderr}`);
  await symlink(resolve('node_modules'), join(temp, 'query-helper/node_modules'), 'dir');
  report.phases.query_harness_build_ms = queryBuild.duration;
  const queryHarness = await import(
    pathToFileURL(join(temp, 'query-helper/benchmark-query.js')).href
  );
  report.phases.warm_materialized_queries = await queryHarness.runQuerySamples(dbPath, 10, 500);
  report.phases.diagnostic_materialized_queries = await queryHarness.runQuerySamples(
    diagnosticPath,
    10,
    50,
  );

  const buildTimes = [];
  for (let i = 0; i < 10; i += 1) {
    const start = performance.now();
    const result = timedSpawn('npm', ['run', 'build'], {
      env: { ...process.env, npm_config_loglevel: 'silent' },
      timeout: 60_000,
    });
    if (result.status !== 0)
      throw new Error(`Production server+web build sample ${i + 1} failed: ${result.stderr}`);
    buildTimes.push(performance.now() - start);
  }
  report.phases.production_build_10 = summarize(buildTimes);
  report.phases.production_build_10.definition = 'Full npm run build (server and browser output).';

  report.phases.process_contention = await contention(dbPath, env, inputDirectory);
  if (report.phases.process_contention.failures > 0)
    throw new Error('One or more independent contention workers failed');
  report.status = 'completed';
} catch (error) {
  report.status = 'failed';
  report.failure = error instanceof Error ? error.message : 'Unknown benchmark failure';
} finally {
  report.finished_at = new Date().toISOString();
  report.duration_ms = Math.round(performance.now() - startedAt);
  report.exit_code = report.status === 'completed' ? 0 : 1;
  const reportPath = join(out, `${started.replaceAll(':', '-')}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await rm(temp, { recursive: true, force: true });
  process.stdout.write(
    `${JSON.stringify({ report: reportPath, status: report.status, duration_ms: report.duration_ms })}\n`,
  );
  if (report.status !== 'completed') process.exitCode = 1;
}

async function exists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
function verifySeedCounts(sqlite, expected) {
  const actual = {
    projects: sqlite.prepare('SELECT count(*) FROM projects').pluck().get(),
    tasks: sqlite.prepare('SELECT count(*) FROM tasks').pluck().get(),
    occurrences: sqlite.prepare('SELECT count(*) FROM occurrences').pluck().get(),
    audits: sqlite.prepare('SELECT count(*) FROM audit_records').pluck().get(),
  };
  for (const [key, value] of Object.entries(actual))
    if (value !== expected[key]) throw new Error(`Seeded ${key} count does not match its profile`);
}
async function contention(path, environment, directory) {
  const workerPath = resolve('scripts/benchmark-process-worker.mjs');
  const workers = [
    ...Array.from({ length: 4 }, (_, index) => ({ mode: 'writer', index })),
    ...Array.from({ length: 20 }, (_, index) => ({ mode: 'reader', index })),
  ];
  const children = workers.map(({ mode, index }) => {
    const child = fork(workerPath, [mode], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: {
        ...environment,
        AI_TASKS_DB_PATH: path,
        AI_TASKS_BENCH_INPUT_DIR: directory,
        AI_TASKS_BENCH_INDEX: String(index),
      },
    });
    let stderr = '';
    child.stderr?.setEncoding('utf8').on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    return { child, mode, index, stderr: () => stderr };
  });
  let ready;
  try {
    ready = await Promise.all(
      children.map(
        ({ child }) =>
          new Promise((resolveReady, rejectReady) => {
            const timer = setTimeout(
              () => rejectReady(new Error('Worker readiness timed out')),
              30_000,
            );
            child.on('message', (message) => {
              if (message?.type === 'error') {
                clearTimeout(timer);
                rejectReady(new Error(message.message));
              }
              if (message?.type === 'ready') {
                clearTimeout(timer);
                resolveReady(message);
              }
            });
            child.once('error', (error) => {
              clearTimeout(timer);
              rejectReady(error);
            });
            child.once('exit', (code, signal) => {
              clearTimeout(timer);
              rejectReady(new Error(`Worker exited before readiness (${code ?? signal})`));
            });
          }),
      ),
    );
  } catch (error) {
    for (const { child } of children) child.kill('SIGTERM');
    await Promise.all(
      children.map(({ child }) =>
        child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : new Promise((done) => child.once('exit', done)),
      ),
    );
    throw error;
  }
  const start = performance.now();
  const finished = Promise.all(
    children.map(
      ({ child }) =>
        new Promise((resolveResult) => {
          let response;
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolveResult({ type: 'timeout' });
          }, 60_000);
          child.on('message', (message) => {
            if (message?.type === 'result' || message?.type === 'error') response = message;
          });
          child.once('exit', (code, signal) => {
            clearTimeout(timer);
            resolveResult(
              response?.type === 'result' && code === 0
                ? response
                : { type: 'exit', code, signal, response },
            );
          });
        }),
    ),
  );
  for (const { child } of children) child.send({ type: 'go' });
  const results = await finished;
  const failures = results.filter(
    (result, index) =>
      result.type !== 'result' ||
      !Array.isArray(result.calls) ||
      result.calls.length !== (workers[index]?.mode === 'writer' ? 10 : 1) ||
      result.calls.some((call) => call.status !== 0),
  );
  return {
    writers: 4,
    readers: 20,
    ready_workers: ready.length,
    duration_ms: performance.now() - start,
    failures: failures.length,
    results,
    diagnostics: failures.map((failure, index) => ({ failure, stderr: children[index]?.stderr() })),
    measured_calls: summarize(
      results.flatMap((result) =>
        result.type === 'result' && Array.isArray(result.calls)
          ? result.calls.map((call) => call.duration_ms)
          : [],
      ),
    ),
  };
}
