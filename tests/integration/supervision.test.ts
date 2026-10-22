import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/api/app.js';
import { startDataHelper } from '../../src/api/helper-client.js';
import { errorEnvelopeSchema } from '../../src/schema/envelopes.js';
import { metaEnvelopeSchema } from '../../src/schema/meta.js';
import { createOrdinaryFixture, ordinarySnapshot } from '../fixtures/ordinary-work.js';
import { boundedResult, supervisedServe } from '../fixtures/supervised-serve.js';

function singleLine(output: string): unknown {
  expect(output.endsWith('\n')).toBe(true);
  const lines = output.trimEnd().split('\n');
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0] ?? '');
}

describe('compiled serve supervision', () => {
  it('exits nonzero with one safe error after its actual data helper unexpectedly dies', async () => {
    const fixture = await createOrdinaryFixture();
    const server = await supervisedServe(fixture.path);
    const before = ordinarySnapshot(fixture);
    try {
      const readiness = await server.ready;
      expect(readiness.data.database_epoch).toBe(fixture.epoch);
      const processes = server.killHelper();
      expect(processes.helperPid).not.toBe(processes.apiPid);
      const outcome = await boundedResult(server.completed, 2500);
      expect(
        outcome,
        'Serve must terminate after its verified real data-helper child receives SIGKILL',
      ).not.toBe('still-running');
      if (outcome === 'still-running')
        throw new Error('Unexpected helper death left serve running');
      expect(outcome.signal).toBeNull();
      expect(outcome.code).not.toBeNull();
      expect(outcome.code).not.toBe(0);
      expect(metaEnvelopeSchema.parse(singleLine(server.output().stdout))).toEqual(readiness);
      const failure = errorEnvelopeSchema.parse(singleLine(server.output().stderr));
      expect(['INTERNAL_ERROR', 'MAINTENANCE']).toContain(failure.error.code);
      expect(failure.error.details).toBeNull();
      expect(server.output().stderr).not.toContain(fixture.directory);
      expect(server.output().stderr).not.toMatch(
        /\bat (?:\S+\s+)?\(?file:|node:internal|SIGKILL|\bpid\b/iu,
      );
      expect(ordinarySnapshot(fixture)).toEqual(before);
    } finally {
      await server.close();
      await fixture.close();
    }
  });

  it('emits only readiness and exits zero for normal SIGTERM', async () => {
    const fixture = await createOrdinaryFixture();
    const server = await supervisedServe(fixture.path);
    const before = ordinarySnapshot(fixture);
    try {
      const readiness = await server.ready;
      server.stop();
      expect(await boundedResult(server.completed, 2500)).toEqual({ code: 0, signal: null });
      expect(metaEnvelopeSchema.parse(singleLine(server.output().stdout))).toEqual(readiness);
      expect(server.output().stderr).toBe('');
      expect(ordinarySnapshot(fixture)).toEqual(before);
    } finally {
      await server.close();
      await fixture.close();
    }
  });

  it('keeps the shell available after intentional helper maintenance close', async () => {
    const fixture = await createOrdinaryFixture();
    const failures: Error[] = [];
    const helper = await startDataHelper({
      databasePath: fixture.path,
      onUnexpectedFailure(error) {
        failures.push(error);
      },
    });
    const app = createApp({ helper });
    const before = ordinarySnapshot(fixture);
    try {
      await app.ready();
      await helper.close();
      expect(failures).toEqual([]);
      const shell = await app.inject({ url: '/', headers: { host: '127.0.0.1:3000' } });
      expect(shell.statusCode).toBe(200);
      const response = await app.inject({
        url: '/api/v1/meta?all_projects=true',
        headers: { host: '127.0.0.1:3000' },
      });
      expect(response.statusCode).toBe(503);
      expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe('MAINTENANCE');
      expect(ordinarySnapshot(fixture)).toEqual(before);
    } finally {
      await app.close();
      await fixture.close();
    }
  });
});
