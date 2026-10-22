import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { resolve, join, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { gzipSync } from 'node:zlib';

const budget = 150_000;
const gzipOptions = Object.freeze({ level: 9 });
const javascriptExtension = /\.(?:js|mjs|cjs)$/iu;

function inventoryPath(value) {
  return (
    typeof value === 'string' &&
    value.isWellFormed() &&
    !/[\\\0]/u.test(value) &&
    !posix.isAbsolute(value) &&
    !/^[A-Za-z]:/u.test(value) &&
    value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..') &&
    javascriptExtension.test(value)
  );
}

function parseInventory(contents) {
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(contents));
  if (
    manifest === null ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    Object.keys(manifest).some((key) => !['version', 'javascript'].includes(key)) ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.javascript) ||
    manifest.javascript.length === 0 ||
    !manifest.javascript.every(inventoryPath)
  )
    throw new Error('Missing or invalid emitted JavaScript inventory');
  if (new Set(manifest.javascript).size !== manifest.javascript.length)
    throw new Error('Emitted JavaScript inventory contains duplicate paths');
  return manifest.javascript.toSorted();
}

async function regularFile(path) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error('Browser output must contain only regular files and directories');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino)
      throw new Error('Browser output changed while measuring');
    const contents = await handle.readFile();
    const after = await handle.stat();
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs)
      throw new Error('Browser output changed while measuring');
    return contents;
  } finally {
    await handle.close();
  }
}

async function javascriptFiles(root, directory = root) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(directory)) !== directory)
    throw new Error('Browser output root and directories must be canonical directories');
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const current = await lstat(path);
    if (current.isSymbolicLink()) throw new Error('Browser output must not contain symbolic links');
    if (current.isDirectory()) files.push(...(await javascriptFiles(root, path)));
    else {
      if (!current.isFile()) throw new Error('Browser output contains a nonregular file');
      if (/\.node$/iu.test(entry.name))
        throw new Error('Native server binaries cannot enter browser output');
      if (javascriptExtension.test(entry.name))
        files.push(relative(root, path).replaceAll('\\', '/'));
    }
  }
  return files.toSorted();
}

/** The CLI and boundary tests use this exact aggregation and strict budget decision. */
export function bundleReport(assets) {
  if (!Array.isArray(assets) || assets.length === 0)
    throw new Error('No emitted browser JavaScript was measured');
  let total = 0;
  const names = new Set();
  for (const asset of assets) {
    if (
      !inventoryPath(asset.file) ||
      names.has(asset.file) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes < 0 ||
      !Number.isSafeInteger(asset.gzip_bytes) ||
      asset.gzip_bytes < 0
    )
      throw new Error('Invalid measured browser asset');
    names.add(asset.file);
    total += asset.gzip_bytes;
    if (!Number.isSafeInteger(total)) throw new Error('Browser bundle total is not a safe integer');
  }
  return {
    assets,
    total_gzip_bytes: total,
    budget_bytes: budget,
    gzip_options: gzipOptions,
    node: process.versions.node,
    zlib: process.versions.zlib,
    passed: total < budget,
  };
}

/** Discover independently of the inventory so neither lazy nor precache JS can disappear. */
export async function measureBrowserBundle(directory = 'web/dist') {
  const root = resolve(directory);
  // Validate the root before opening its inventory, including aliases through ancestor symlinks.
  const files = await javascriptFiles(root);
  const inventory = parseInventory(await regularFile(join(root, 'browser-assets.json')));
  if (JSON.stringify(files) !== JSON.stringify(inventory))
    throw new Error('Emitted JavaScript differs from the build inventory');
  const assets = [];
  for (const file of files) {
    const contents = await regularFile(join(root, file));
    assets.push({
      file,
      bytes: contents.length,
      gzip_bytes: gzipSync(contents, gzipOptions).length,
    });
  }
  return bundleReport(assets);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const report = await measureBrowserBundle(process.argv[2]);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passed ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Bundle measurement failed'}\n`,
    );
    process.exitCode = 1;
  }
}
