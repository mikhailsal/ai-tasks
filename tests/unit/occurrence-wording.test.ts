import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { occurrenceLabels } from '../../web/src/screens/occurrence-model.js';
import { buildFixture } from '../fixtures/help-fixtures.js';

/** Spec 006: `completed_late` is described as a recording after the window, never as late work. */
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'ai-tasks-wording-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

it('the web label says the completion was recorded after the window', () => {
  expect(occurrenceLabels.completed_late).toBe('Записано после окна');
});

it('the human stats summary uses the same wording', () => {
  const env = buildFixture('empty_project', directory);
  const result = spawnSync(
    process.execPath,
    [join(root, 'dist/cli.js'), 'stats', '--project', 'demo'],
    { env, encoding: 'utf8' },
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('записаны после окна 0');
});

function files(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((name) => files(join(path, name)));
}

it('the old wording appears nowhere a person reads (SC-001)', () => {
  const places = ['web/src', 'src', 'docs', 'README.md'].flatMap((place) =>
    files(join(root, place)),
  );
  const old = /Выполнено поздно|поздние/u;
  expect(places.filter((path) => old.test(readFileSync(path, 'utf8')))).toEqual([]);
});
