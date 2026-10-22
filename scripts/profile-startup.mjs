import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';

const directory = resolve('artifacts/startup-profile');
await mkdir(directory, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), 'ai-tasks-startup-profile-'));
const databasePath = join(temporary, 'profile.sqlite');
const env = { ...process.env, AI_TASKS_DB_PATH: databasePath };
const summary = [];
try {
  execute(['dist/migrate.js']);
  const { seedBenchmarkData, standardBenchmarkSize } =
    await import('../tests/fixtures/benchmark-data.ts');
  const database = new Database(databasePath);
  try {
    seedBenchmarkData(database, standardBenchmarkSize);
  } finally {
    database.close();
  }
  for (let index = 0; index < 8; index += 1) {
    const name = `cli-${index}.cpuprofile`;
    const reply = execute([
      '--cpu-prof',
      `--cpu-prof-dir=${directory}`,
      `--cpu-prof-name=${name}`,
      'dist/cli.js',
      'project',
      'list',
      '--all-projects',
      '--json',
    ]);
    if (JSON.parse(reply.stdout).data.items.length !== standardBenchmarkSize.projects)
      throw new Error('Unexpected profile workload output');
    const profile = JSON.parse(await readFile(join(directory, name), 'utf8'));
    const frames = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
    const costs = new Map();
    for (const [sample, id] of profile.samples.entries()) {
      const frame = frames.get(id);
      const key = JSON.stringify(frame);
      const cost = costs.get(key) ?? { ...frame, sampled_us: 0 };
      cost.sampled_us += profile.timeDeltas[sample];
      costs.set(key, cost);
    }
    summary.push({
      profile: name,
      duration_ms: reply.duration,
      frames: [...costs.values()].sort((left, right) => right.sampled_us - left.sampled_us),
    });
  }
  await writeFile(join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ profiles: summary.length, directory })}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
function execute(args) {
  const started = performance.now();
  const reply = spawnSync(process.execPath, args, {
    env,
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 2_000_000,
  });
  if (reply.error || reply.status !== 0)
    throw new Error(`Profile command failed: ${reply.error?.message ?? reply.stderr}`);
  return { ...reply, duration: performance.now() - started };
}
