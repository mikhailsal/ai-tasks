import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { domainError, errorEnvelope } from '../../src/core/errors.js';
import { coordinateRestore, startSupervisorControl } from '../../src/runtime/supervisor-control.js';

it.each([
  'CONFIRMATION_REQUIRED',
  'REVISION_CONFLICT',
  'CONFIG_CONFLICT',
  'DATABASE_EPOCH_CONFLICT',
] as const)(
  'preserves %s and structured diagnostics through the real private supervisor socket and CLI normalization',
  async (code) => {
    const directory = await mkdtemp(join(tmpdir(), 'ai-tasks-control-errors-'));
    const databasePath = join(directory, 'application.sqlite');
    const expected = domainError(code, 'Authored recovery diagnostic', {
      scope: 'settings',
      expected: 1,
      actual: 2,
      source: '  Точный исходник 🧪\n',
    });
    const control = await startSupervisorControl({
      databasePath,
      async submitRestore() {
        throw expected;
      },
    });
    try {
      let caught: unknown;
      try {
        await coordinateRestore({
          databasePath,
          projectSlug: 'alpha',
          envelope: { operation_id: randomUUID(), database_epoch: randomUUID(), payload: {} },
          async startStandalone() {
            throw new Error('Must use active owner');
          },
        });
      } catch (error) {
        caught = error;
      }
      expect(errorEnvelope(caught)).toEqual(errorEnvelope(expected));
    } finally {
      await control.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
