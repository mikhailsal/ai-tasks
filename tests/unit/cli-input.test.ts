import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { mutationInput, readJsonInput, scopedInput } from '../../src/cli/io.js';
import { positiveIntegerOption, readScope } from '../../src/cli/options.js';
import { BODY_LIMIT_BYTES } from '../../src/schema/values.js';

const directories: string[] = [];
const operationId = randomUUID();
const epoch = randomUUID();
const flags = { project: 'alpha', operationId, databaseEpoch: epoch };

async function* chunks(...values: Uint8Array[]) {
  yield* values;
}

function inputBytes(text: string) {
  return chunks(new TextEncoder().encode(text));
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it('does not consume stdin unless explicitly selected and rejects empty EOF without waiting', async () => {
  let read = false;
  async function* forbidden() {
    read = true;
    yield new Uint8Array();
  }
  await expect(readJsonInput(undefined, forbidden())).resolves.toEqual({});
  expect(read).toBe(false);
  await expect(readJsonInput('-', chunks())).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
});

it('reads equivalent Unicode JSON from a file and chunked stdin without modifying the file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-tasks-cli-input-'));
  directories.push(directory);
  const path = join(directory, 'proposal.json');
  const text = JSON.stringify({ title: '🔵 Задача', description: '# План\n\n**Без изменений**\n' });
  await writeFile(path, text);
  const bytes = new TextEncoder().encode(text);
  const stdin = chunks(bytes.slice(0, 12), bytes.slice(12, 13), bytes.slice(13));
  expect(await readJsonInput(path)).toEqual(await readJsonInput('-', stdin));
  expect(await readFile(path, 'utf8')).toBe(text);
});

it.each(['', ' ', '{broken', 'null', '[]', '42'])(
  'rejects empty or non-object JSON input %j',
  async (text) => {
    await expect(readJsonInput('-', inputBytes(text))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  },
);

it('rejects malformed UTF-8 before JSON parsing', async () => {
  await expect(readJsonInput('-', chunks(new Uint8Array([0xc3, 0x28])))).rejects.toMatchObject({
    code: 'VALIDATION_ERROR',
  });
});

it('caps raw input bytes and closes an oversized source', async () => {
  let closed = false;
  async function* oversized() {
    try {
      yield new Uint8Array(BODY_LIMIT_BYTES + 1);
    } finally {
      closed = true;
    }
  }
  await expect(readJsonInput('-', oversized())).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  expect(closed).toBe(true);
});

it('normalizes scope and envelope flags without changing the original payload', () => {
  const body = { project_slug: 'alpha', description: '# 原文\n⚪', priority: null };
  const result = mutationInput(
    { ...flags, expectedRevision: '3', expectedConfigRevision: '2' },
    body,
  );
  expect(result).toEqual({
    projectSlug: 'alpha',
    input: {
      operation_id: operationId,
      database_epoch: epoch,
      expected_revision: 3,
      expected_config_revision: 2,
      payload: { description: '# 原文\n⚪', priority: null },
    },
  });
  expect(body.project_slug).toBe('alpha');
});

it('accepts envelope preconditions from JSON without coercing operation payload values', () => {
  expect(
    mutationInput(
      { project: 'alpha' },
      {
        operation_id: operationId,
        database_epoch: epoch,
        expected_revision: 2,
        expected_config_revision: 3,
        expected_settings_revision: 4,
        priority: '1.001',
      },
    ).input,
  ).toEqual({
    operation_id: operationId,
    database_epoch: epoch,
    expected_revision: 2,
    expected_config_revision: 3,
    expected_settings_revision: 4,
    payload: { priority: '1.001' },
  });
});

it.each([
  ['operation_id', 'operationId', operationId],
  ['database_epoch', 'databaseEpoch', epoch],
  ['expected_revision', 'expectedRevision', '2'],
  ['expected_config_revision', 'expectedConfigRevision', '2'],
  ['expected_settings_revision', 'expectedSettingsRevision', '2'],
] as const)('rejects %s duplicated in a flag and JSON even when equal', (field, option, value) => {
  const bodyValue = field.startsWith('expected_') ? 2 : value;
  expect(() => mutationInput({ ...flags, [option]: value }, { [field]: bodyValue })).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
});

it.each(['0', '-1', '1.0', '1e3', '2x', 'NaN', ' 2', '9007199254740992'])(
  'rejects noncanonical or unsafe integer revision flag %j',
  (value) => {
    expect(() => positiveIntegerOption(value)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  },
);

it('requires explicit read scope and forbids aggregate mutation scope or a mismatched body scope', () => {
  expect(readScope({ allProjects: true })).toEqual({ all_projects: true });
  expect(readScope({ project: 'alpha' })).toEqual({ project_slug: 'alpha' });
  expect(() => readScope({})).toThrow();
  expect(() => readScope({ project: 'alpha', allProjects: true })).toThrow();
  expect(() => mutationInput({ allProjects: true }, {})).toThrow();
  expect(() => scopedInput(flags, { project_slug: 'beta' })).toThrow();
  expect(() => scopedInput({ allProjects: true }, { project_slug: 'alpha' })).toThrow();
});
