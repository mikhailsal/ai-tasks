import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

assert.equal(process.platform, 'linux', 'This release requires Linux');
assert.equal(process.versions.node, '24.22.0', 'Use the pinned Node runtime');
const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
assert.equal(npmVersion, '11.19.1', 'Use the pinned npm version');
execFileSync('flock', ['--version'], { stdio: 'pipe' });

const directory = mkdtempSync(join(tmpdir(), 'ai-tasks-native-'));
try {
  const database = new Database(join(directory, 'native.sqlite'));
  try {
    const version = database.prepare('SELECT sqlite_version() AS version').get().version;
    const parts = version.split('.').map(Number);
    assert.ok(
      parts[0] > 3 || (parts[0] === 3 && (parts[1] > 51 || (parts[1] === 51 && parts[2] >= 3))),
      `SQLite ${version} is older than 3.51.3`,
    );
    database.pragma('foreign_keys = ON');
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = NORMAL');
    database.pragma('busy_timeout = 5000');
    assert.equal(database.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(database.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(database.pragma('synchronous', { simple: true }), 1);
    assert.equal(database.pragma('busy_timeout', { simple: true }), 5000);
    console.log(JSON.stringify({ node: process.versions.node, npm: npmVersion, sqlite: version }));
  } finally {
    database.close();
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
