import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { bundleReport, measureBrowserBundle } from '../../scripts/check-bundle-size.mjs';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ai-tasks-bundle-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
async function file(path: string, contents: string | Uint8Array) {
  const target = join(directory, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}
async function inventory(javascript: unknown, extra: Record<string, unknown> = {}) {
  await file('browser-assets.json', JSON.stringify({ version: 1, javascript, ...extra }));
}
const reportSchema = z.strictObject({
  assets: z.array(z.strictObject({ file: z.string(), bytes: z.number(), gzip_bytes: z.number() })),
  total_gzip_bytes: z.number(),
  budget_bytes: z.literal(150000),
  gzip_options: z.strictObject({ level: z.literal(9) }),
  node: z.string(),
  zlib: z.string(),
  passed: z.boolean(),
});
const checker = fileURLToPath(new URL('../../scripts/check-bundle-size.mjs', import.meta.url));
function cli(root = directory) {
  return spawnSync(process.execPath, [checker, root], { encoding: 'utf8', timeout: 5000 });
}

it('cannot claim a passing report when no emitted JavaScript was measured', () => {
  expect(() => bundleReport([])).toThrow(/No emitted/u);
});

it('counts every nested lazy, worker, service-worker and alternate-extension JavaScript independently at gzip level 9', async () => {
  const sources = {
    'assets/app.js': 'export const main = "Приложение";',
    'assets/lazy/settings.mjs': 'export default "Настройки";',
    'assets/worker/runtime.cjs': 'self.onmessage = () => postMessage("готово");',
    'sw.js': 'self.addEventListener("fetch", () => {});',
    'precache/chunks/cache.JS': 'export const cache = true;',
    'dist/server/api.js': 'export const misplacedButStillCounted = true;',
  };
  for (const [path, source] of Object.entries(sources)) await file(path, source);
  await file('assets/app.js.map', '{"sourcesContent":["large unshipped sources"]}');
  await file('assets/style.css', 'main { color: black; }');
  await file('.vite/manifest.json', '{"app":{"file":"assets/app.js"}}');
  await inventory(Object.keys(sources).reverse());
  const report = await measureBrowserBundle(directory);
  const expected = Object.entries(sources)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, source]) => ({
      file: path,
      bytes: Buffer.byteLength(source),
      gzip_bytes: gzipSync(source, { level: 9 }).length,
    }));
  expect(report.assets).toEqual(expected);
  expect(report.total_gzip_bytes).toBe(expected.reduce((sum, asset) => sum + asset.gzip_bytes, 0));
  expect(report.total_gzip_bytes).not.toBe(
    gzipSync(Object.values(sources).join(''), { level: 9 }).length,
  );
  expect(report).toMatchObject({
    budget_bytes: 150000,
    gzip_options: { level: 9 },
    node: process.versions.node,
    zlib: process.versions.zlib,
    passed: true,
  });
});

it.each([
  [149999, true],
  [150000, false],
  [150001, false],
] as const)('the production report decides exact summed boundary %i as %s', (total, passed) => {
  const assets = [
    { file: 'app.js', bytes: 400000, gzip_bytes: 100000 },
    { file: 'nested/lazy.mjs', bytes: 200000, gzip_bytes: total - 100000 },
  ];
  expect(bundleReport(assets)).toEqual({
    assets,
    total_gzip_bytes: total,
    budget_bytes: 150000,
    gzip_options: { level: 9 },
    node: process.versions.node,
    zlib: process.versions.zlib,
    passed,
  });
});

it('the real CLI emits exactly the production JSON report, runtime/options and zero status for a passing nested root', async () => {
  const nested = join(directory, 'nested output');
  await mkdir(nested);
  await writeFile(join(nested, 'app.js'), 'console.log("реальный файл");');
  await writeFile(
    join(nested, 'browser-assets.json'),
    JSON.stringify({ version: 1, javascript: ['app.js'] }),
  );
  const result = cli(nested);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(reportSchema.parse(JSON.parse(result.stdout))).toEqual(await measureBrowserBundle(nested));
});

it('the real CLI returns one failing report and nonzero exit for an actual oversized JavaScript asset', async () => {
  const noise = Array.from({ length: 5000 }, (_, index) =>
    createHash('sha256').update(String(index)).digest('hex'),
  ).join('');
  const source = `/*${noise}*/`;
  await file('app.js', source);
  await inventory(['app.js']);
  const result = cli();
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('');
  const report = reportSchema.parse(JSON.parse(result.stdout));
  expect(report.total_gzip_bytes).toBe(gzipSync(source, { level: 9 }).length);
  expect(report.total_gzip_bytes).toBeGreaterThanOrEqual(150000);
  expect(report.passed).toBe(false);
});

it.each(['missing-chunk', 'extra-path', 'duplicate'])(
  'rejects %s in the exported inventory',
  async (kind) => {
    await file('app.js', 'export {};');
    await file('lazy/sw.mjs', 'export {};');
    const paths =
      kind === 'missing-chunk'
        ? ['app.js']
        : kind === 'extra-path'
          ? ['app.js', 'lazy/sw.mjs', 'absent.js']
          : ['app.js', 'lazy/sw.mjs', 'app.js'];
    await inventory(paths);
    await expect(measureBrowserBundle(directory)).rejects.toThrow(/inventory/u);
  },
);

it.each([
  '../outside.js',
  '/outside.js',
  'assets/../app.js',
  './app.js',
  'assets//app.js',
  'assets\\app.js',
  'C:/outside.js',
  'app.js.map',
  'native.node',
  'bad\0.js',
])('rejects noncanonical or non-JavaScript inventory path %s', async (path) => {
  await file('app.js', 'export {};');
  await inventory(['app.js', path]);
  await expect(measureBrowserBundle(directory)).rejects.toThrow(/inventory/u);
});

it.each([
  null,
  [],
  { version: 2, javascript: ['app.js'] },
  { version: 1, javascript: [] },
  { version: 1, javascript: [42] },
  { version: 1, javascript: ['app.js'], hidden: ['lazy.js'] },
])('rejects malformed inventory metadata %j', async (value) => {
  await file('app.js', 'export {};');
  await file('browser-assets.json', JSON.stringify(value));
  await expect(measureBrowserBundle(directory)).rejects.toThrow(/inventory/u);
});

it('missing, invalid JSON and malformed UTF-8 inventories fail the actual CLI with no success report', async () => {
  await file('app.js', 'export {};');
  for (const contents of [undefined, '{', Buffer.from([0xff])]) {
    if (contents !== undefined) await file('browser-assets.json', contents);
    const result = cli();
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).not.toBe('');
  }
});

it.each(['root', 'ancestor', 'asset', 'directory', 'inventory'])(
  'rejects a symbolic-link %s rather than following output aliases',
  async (kind) => {
    await file('real/app.js', 'export {};');
    await file('real/browser-assets.json', JSON.stringify({ version: 1, javascript: ['app.js'] }));
    let root = join(directory, 'real');
    if (kind === 'root' || kind === 'ancestor') {
      await symlink(root, join(directory, 'alias'), 'dir');
      root = kind === 'root' ? join(directory, 'alias') : join(directory, 'alias', 'nested');
      if (kind === 'ancestor') {
        await file('real/nested/app.js', 'export {};');
        await file(
          'real/nested/browser-assets.json',
          JSON.stringify({ version: 1, javascript: ['app.js'] }),
        );
      }
    } else if (kind === 'asset') {
      await symlink('app.js', join(root, 'hidden.mjs'));
    } else if (kind === 'directory') {
      await symlink('.', join(root, 'linked'), 'dir');
    } else {
      await rm(join(root, 'browser-assets.json'));
      await symlink('../manifest.json', join(root, 'browser-assets.json'));
      await file('manifest.json', JSON.stringify({ version: 1, javascript: ['app.js'] }));
    }
    await expect(measureBrowserBundle(root)).rejects.toThrow(/symbolic|canonical|regular/u);
  },
);

it('rejects native server binaries even if the JavaScript inventory omits them', async () => {
  await file('app.js', 'export {};');
  await file('native/better_sqlite3.node', Buffer.from([1, 2, 3]));
  await inventory(['app.js']);
  await expect(measureBrowserBundle(directory)).rejects.toThrow(/Native server/u);
});

it.each(['root', 'asset', 'inventory'])(
  'rejects a nonregular %s without opening a FIFO or waiting for a writer',
  async (kind) => {
    await file('app.js', 'export {};');
    await inventory(['app.js']);
    const target =
      kind === 'root'
        ? join(directory, 'fifo-root')
        : join(directory, kind === 'asset' ? 'hidden.js' : 'browser-assets.json');
    if (kind === 'inventory') await rm(target);
    const created = spawnSync('mkfifo', [target], { encoding: 'utf8', timeout: 1000 });
    expect(created.error).toBeUndefined();
    expect(created.status).toBe(0);
    const result = cli(kind === 'root' ? target : directory);
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/regular|canonical/u);
  },
);
