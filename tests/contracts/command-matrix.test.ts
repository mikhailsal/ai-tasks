import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { errorEnvelopeSchema, successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { timestampSchema, uuidSchema } from '../../src/schema/values.js';
import {
  commandMatrix,
  createMatrixHarness,
  informationalCommands,
  informationalEvidence,
  invokeMatrixCli,
  jsonLine,
  laterExtensions,
  recoveryContractSuite,
  recoveryContractEntries,
  recoveryRegistrations,
  recoveryDelegations,
  matrixInvocation,
  matrixRequest,
  type MatrixHarness,
} from '../fixtures/contract-matrix.js';
const root = resolve(import.meta.dirname, '../..');
const cliContract = readFileSync(
  resolve(root, 'specs/001-ai-task-manager/contracts/cli.md'),
  'utf8',
);
const httpContract = readFileSync(
  resolve(root, 'specs/001-ai-task-manager/contracts/http.md'),
  'utf8',
);
// Recovery reads use their own real snapshot/job fixtures and explicit delegation below.
const readyReads = commandMatrix.filter(
  (row) => row.readiness === 'ready' && row.kind === 'R' && row.owner !== 'US6',
);
const mutationRows = commandMatrix.filter(
  (row) => row.command === 'task update <task-id>' || row.command === 'task transition <task-id>',
);
let harness: MatrixHarness;
function envelope(value: unknown) {
  const parsed = successEnvelopeSchema.parse(value);
  expect(uuidSchema.safeParse(parsed.meta.database_epoch).success).toBe(true);
  expect(timestampSchema.safeParse(parsed.meta.now).success).toBe(true);
  expect(parsed.meta.now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  for (const id of parsed.meta.audit_ids ?? []) expect(uuidSchema.safeParse(id).success).toBe(true);
  if (parsed.meta.operation_id)
    expect(uuidSchema.safeParse(parsed.meta.operation_id).success).toBe(true);
  return parsed;
}
describe('complete normative command/route inventory (later rows are data, never skipped tests)', () => {
  it('matches every application command and type in the CLI contract exactly once', () => {
    const surface = cliContract
      .split('## Complete application command surface')[1]
      ?.split('## Agent workflow')[0];
    if (!surface) throw new Error('CLI application surface table must exist');
    const specified = [...surface.matchAll(/^\| `([^`]+)` \| ([RMO]) \|/gmu)].map(
      (match) => `${match[2]} ${match[1]}`,
    );
    const inventoried = commandMatrix.map((row) => `${row.kind} ${row.command}`);
    expect(specified).toHaveLength(43);
    expect(new Set(inventoried).size).toBe(inventoried.length);
    expect(inventoried.sort()).toEqual(specified.sort());
    for (const utility of informationalCommands) expect(cliContract).toContain(utility.join(' '));
    expect(informationalEvidence).toMatchObject({ owner: 'Foundation', readiness: 'ready' });
    expect(existsSync(resolve(root, informationalEvidence.suite))).toBe(true);
  });
  it('matches every HTTP method/path, including both maintenance-safe job lookup forms', () => {
    function expand(path: string) {
      return path === 'P'
        ? '/projects/:project_slug'
        : path.startsWith('P/')
          ? path.replace('P/', '/projects/:project_slug/')
          : path === 'T'
            ? '/projects/:project_slug/tasks/:task_id'
            : path.startsWith('T/')
              ? path.replace('T/', '/projects/:project_slug/tasks/:task_id/')
              : path;
    }
    const specified = [
      ...httpContract.matchAll(/^\| (GET|POST|PATCH|PUT)(?: [MO])? \| `([^`]+)` \|/gmu),
    ].map((match) => `${match[1]} ${expand(match[2] ?? '')}`);
    const inventoried = commandMatrix.flatMap((row) =>
      row.http.map((route) => `${route.method} ${route.pattern}`),
    );
    expect(specified).toHaveLength(42);
    expect(new Set(inventoried).size).toBe(inventoried.length);
    expect(inventoried.sort()).toEqual(specified.sort());
  });
  it('requires explicit story readiness and real evidence for every ready row, never source-existence inference', () => {
    const completed = ['Foundation', 'US1', 'US2', 'US3', 'US4', 'US5', 'US6'];
    for (const row of commandMatrix) {
      expect(row.reason.length).toBeGreaterThan(20);
      const expected = completed.includes(row.owner) ? 'ready' : 'pending';
      expect(row.readiness).toBe(expected);
      if (row.readiness === 'pending') {
        expect(row.evidence).toBeNull();
        expect(row.owner).toBe('US6');
      } else {
        if (row.command === 'worker run')
          expect(row.evidence).toBe('tests/integration/worker.test.ts');
        else expect(row.evidence).toMatch(/^tests\/contracts\/.+\.test\.ts$/u);
        if (row.owner === 'US6') expect(row.evidence).toBe(recoveryContractSuite);
        if (row.owner === 'US4') expect(row.evidence).toBe('tests/contracts/read-views.test.ts');
        if (row.owner === 'US5' && row.command !== 'worker run')
          expect(row.evidence).toBe('tests/contracts/recurrence-settings.test.ts');
        expect(existsSync(resolve(root, row.evidence ?? ''))).toBe(true);
      }
    }
    expect(commandMatrix.filter((row) => row.readiness === 'ready')).toHaveLength(43);
    expect(commandMatrix.filter((row) => row.readiness === 'pending')).toHaveLength(0);
    expect(
      commandMatrix.filter((row) => row.readiness === 'target').map((row) => row.command),
    ).toEqual([]);
    for (const command of laterExtensions.US5)
      expect(
        commandMatrix.some((row) => row.command === command && row.readiness === 'ready'),
      ).toBe(true);
    const source = readFileSync(import.meta.filename, 'utf8');
    expect(source).not.toMatch(/\b(?:it|test|describe)\s*\.\s*(?:skip|todo)\s*\(/u);
  });
});
describe('accepted recovery rows use their real operational transport contracts', () => {
  const commonSource = readFileSync(resolve(root, recoveryContractSuite), 'utf8');
  const registrations = readFileSync(resolve(root, recoveryRegistrations), 'utf8');
  const source = `${commonSource}\n${registrations}`;
  it('delegates exactly the five US6 rows without dropping them from the complete inventory', () => {
    const operational = commandMatrix.filter((row) => row.owner === 'US6');
    expect(operational).toHaveLength(5);
    expect(recoveryDelegations.map((entry) => entry.command).sort()).toEqual(
      operational.map((row) => row.command).sort(),
    );
    expect(readyReads.some((row) => row.owner === 'US6')).toBe(false);
    for (const { transport, entry } of recoveryContractEntries) {
      const runnable = readFileSync(resolve(root, entry), 'utf8');
      expect(runnable).toContain('const context = installRecoveryContracts();');
      expect(runnable).toContain(`registerRecoveryTransportContracts('${transport}', context);`);
      expect(runnable).toContain(`registerRestoreTransportContracts('${transport}', context);`);
      expect(runnable).not.toMatch(/\b(?:it|test|describe)\s*\.\s*(?:skip|todo)\s*\(/u);
    }
    expect(registrations).toContain('await current().request(transport,');
    expect(registrations).toContain('expect(current().snapshot()).toEqual(before)');
    expect(source).not.toMatch(/\b(?:it|test|describe)\s*\.\s*(?:skip|todo)\s*\(/u);
  });
  it.each(recoveryDelegations)(
    '$command has explicit named operational assertion evidence',
    (entry) => {
      const row = commandMatrix.find((item) => item.command === entry.command);
      expect(row).toMatchObject({
        owner: 'US6',
        readiness: 'ready',
        evidence: recoveryContractSuite,
      });
      expect(entry.scenarios.length).toBeGreaterThan(1);
      for (const scenario of entry.scenarios) expect(source).toContain(scenario);
    },
  );
});
describe('ready compiled adapter invariants (accepted mutation evidence stays in story suites)', () => {
  beforeAll(async () => {
    harness = await createMatrixHarness();
  });
  afterAll(async () => {
    await harness?.close();
  });
  it('recovery rows cannot accidentally enter generic placeholder preparation', async () => {
    for (const entry of recoveryDelegations) {
      const row = commandMatrix.find((item) => item.command === entry.command);
      if (!row) throw new Error('Recovery inventory row is required');
      await expect(matrixInvocation(row, harness)).rejects.toThrow(recoveryContractSuite);
    }
  });
  it.each(readyReads)(
    '$command returns UUID/time envelopes through both adapters without durable effects',
    async (row) => {
      const input = await matrixInvocation(row, harness);
      const before = harness.snapshot();
      for (const transport of ['cli', 'http'] as const) {
        const result = await matrixRequest(harness, transport, input);
        expect(result.status, `${transport}: ${row.command}`).toBe(transport === 'cli' ? 0 : 200);
        envelope(result.envelope);
      }
      expect(harness.snapshot(), row.command).toEqual(before);
    },
  );
  for (const transport of ['cli', 'http'] as const) {
    describe(
      `${transport} exact replay and source attribution`,
      { concurrent: false, shuffle: false },
      () => {
        let isolated: MatrixHarness;
        let completed = 0;
        beforeAll(async () => {
          isolated = await createMatrixHarness();
        });
        afterAll(async () => {
          await isolated?.close();
        });
        it.each(mutationRows)(
          '$command preserves exact replay, source milliseconds, actual consent and fixed actor',
          async (row) => {
            // Transition consumes the preceding verified update, with two real adapter calls per case.
            expect(completed).toBe(row.command.startsWith('task transition') ? 1 : 0);
            const input = await matrixInvocation(row, isolated);
            if (row.command.startsWith('task transition')) input.revision = 2;
            input.operationId = randomUUID();
            const first = await matrixRequest(isolated, transport, input);
            expect(first.status).toBe(transport === 'cli' ? 0 : 200);
            const success = envelope(first.envelope);
            expect(success.meta.operation_id).toBe(input.operationId);
            expect(success.data).toMatchObject({
              description: 'Новый **исходник**\n',
              deadline: '2026-10-21T18:30:40.123Z',
            });
            const beforeReplay = isolated.snapshot();
            expect(await matrixRequest(isolated, transport, input)).toEqual(first);
            expect(isolated.snapshot()).toEqual(beforeReplay);
            const rows = isolated.fixture.connection.sqlite
              .prepare('SELECT actor, confirmation FROM audit_records WHERE operation_id=?')
              .all(input.operationId);
            const audit = z
              .array(z.object({ actor: z.string(), confirmation: z.nullable(z.string()) }))
              .parse(rows);
            expect(audit.length).toBeGreaterThan(0);
            for (const event of audit)
              expect(event.actor).toBe(transport === 'cli' ? 'ai-cli:alpha' : 'human-web');
            if (row.command.startsWith('task transition'))
              expect(
                audit.map((event) => event.confirmation && JSON.parse(event.confirmation)),
              ).toContainEqual({ asserted: true, user_text: 'Проверил именно эту задачу 👩🏽‍💻' });
            completed++;
          },
        );
      },
    );
  }
  it('compiled EOF and scope/parser errors remain one stderr JSON line with no paths or writes', () => {
    const before = harness.snapshot();
    const cases = [
      { args: ['meta', '--all-projects', '--json', '--input', '-'], input: '' },
      { args: ['meta', '--json'] },
      { args: ['meta', '--all-projects', '--project', 'alpha', '--json'] },
      { args: ['meta', '--all-projects', '--unknown-option', '--json'] },
    ];
    for (const example of cases) {
      const result = invokeMatrixCli(harness.fixture.path, example.args, example.input);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(errorEnvelopeSchema.parse(jsonLine(result.stderr)).error.code).toBe(
        'VALIDATION_ERROR',
      );
      expect(result.stderr).not.toContain(harness.fixture.path);
    }
    expect(harness.snapshot()).toEqual(before);
  });
  it.each([
    'missing task',
    'scope mismatch',
    'stale revision',
    'wrong epoch',
    'missing consent',
    'naive time',
    'invalid UUID',
    'actor injection',
  ])(
    'maps %s to equivalent safe HTTP and CLI errors without state/audit/receipt changes',
    async (kind) => {
      const row = commandMatrix.find((item) => item.command === 'task transition <task-id>');
      if (!row) throw new Error('Transition inventory row is required');
      const input = await matrixInvocation(row, harness);
      let code = 'VALIDATION_ERROR';
      let http = 400;
      let exit = 2;
      if (kind === 'missing task') {
        input.command = ['task', 'get', randomUUID()];
        input.path = `/projects/alpha/tasks/${input.command[2]}`;
        input.method = 'GET';
        code = 'TASK_NOT_FOUND';
        http = 404;
        exit = 3;
      }
      if (kind === 'scope mismatch') {
        input.scope = 'beta';
        input.path = input.path.replace('/alpha/', '/beta/');
        code = 'PROJECT_MISMATCH';
        http = 409;
        exit = 4;
      }
      if (kind === 'stale revision') {
        input.revision = 99;
        code = 'REVISION_CONFLICT';
        http = 409;
        exit = 4;
      }
      if (kind === 'wrong epoch') {
        input.epoch = randomUUID();
        code = 'DATABASE_EPOCH_CONFLICT';
        http = 409;
        exit = 4;
      }
      if (kind === 'missing consent') {
        input.body = { to_status_id: 'done' };
        code = 'CONFIRMATION_REQUIRED';
        http = 409;
        exit = 4;
      }
      if (kind === 'naive time') {
        input.command = ['task', 'update', harness.task.id];
        input.path = `/projects/alpha/tasks/${harness.task.id}`;
        input.method = 'PATCH';
        input.body = { deadline: '2026-10-21T18:30:40.123' };
      }
      if (kind === 'invalid UUID') input.operationId = 'not-a-uuid';
      if (kind === 'actor injection') input.body = { ...input.body, actor: 'human-web' };
      const before = harness.snapshot();
      for (const transport of ['http', 'cli'] as const) {
        const result = await matrixRequest(harness, transport, input);
        expect(result.status).toBe(transport === 'http' ? http : exit);
        expect(errorEnvelopeSchema.parse(result.envelope).error.code).toBe(code);
        expect(JSON.stringify(result.envelope)).not.toContain(harness.fixture.path);
        expect(harness.snapshot()).toEqual(before);
      }
    },
  );
});
describe('US3 history adapter rows retain successful compiled behavior', () => {
  beforeAll(async () => {
    harness = await createMatrixHarness();
  });
  afterAll(async () => {
    await harness?.close();
  });
  it.each(['cli', 'http'] as const)(
    '%s audit list succeeds after compiled metadata control on a real migrated database',
    async (transport) => {
      const control = invokeMatrixCli(harness.fixture.path, ['meta', '--all-projects', '--json']);
      expect(control.status).toBe(0);
      expect(control.stderr).toBe('');
      envelope(jsonLine(control.stdout));
      const audit = commandMatrix.find((row) => row.command === 'audit list');
      if (!audit) throw new Error('US3 audit row is required');
      const before = harness.snapshot();
      const result = await matrixRequest(
        harness,
        transport,
        await matrixInvocation(audit, harness),
      );
      expect(result.status).toBe(transport === 'cli' ? 0 : 200);
      const data = envelope(result.envelope).data;
      expect(data).toMatchObject({ items: expect.any(Array), next_cursor: null });
      expect(z.object({ items: z.array(z.unknown()) }).parse(data).items.length).toBeGreaterThan(0);
      expect(harness.snapshot()).toEqual(before);
    },
  );
});
