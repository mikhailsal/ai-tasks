import { beforeEach, afterEach, expect, it } from 'vitest';
import { createProject, updateProject } from '../../src/core/projects/commands.js';
import { createTask, updateTask } from '../../src/core/tasks/commands.js';
import { renderMarkdown } from '../../src/core/markdown/render.js';
import { errorEnvelope } from '../../src/core/errors.js';
import { descriptionSchema, jsonValueSchema } from '../../src/schema/values.js';
import { taskDetailSchema } from '../../src/schema/tasks.js';
import {
  createOrdinaryFixture,
  ordinaryInput,
  ordinarySnapshot,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';

let fixture: OrdinaryFixture;
let taskId: string;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  createProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { slug: 'alpha', name: 'Альфа', emoji: '🔵' }),
  );
  taskId = taskDetailSchema.parse(
    createTask(
      fixture.human,
      'alpha',
      ordinaryInput(fixture, { kind: 'ordinary', title: 'Задача', description: 'Исходный текст' }),
    ).data,
  ).id;
});
afterEach(() => fixture?.close());

const invalidStrings = [
  String.fromCharCode(0xd800),
  String.fromCharCode(0xdc00),
  `Текст ${String.fromCharCode(0xd800)} после`,
];

it.each(invalidStrings)(
  'rejects malformed task source %j before creating or updating any durable state',
  (description) => {
    const before = ordinarySnapshot(fixture);
    const create = ordinaryInput(fixture, {});
    expect(() =>
      createTask(fixture.human, 'alpha', {
        ...create,
        payload: { kind: 'ordinary', title: 'Новая задача', description },
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(ordinarySnapshot(fixture)).toEqual(before);
    const update = ordinaryInput(fixture, {}, { revision: 1 });
    expect(() =>
      updateTask(fixture.human, 'alpha', taskId, { ...update, payload: { description } }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(ordinarySnapshot(fixture)).toEqual(before);
  },
);

it.each(invalidStrings)(
  'rejects malformed project source %j before creating or updating any durable state',
  (description) => {
    const before = ordinarySnapshot(fixture);
    const create = ordinaryInput(fixture, {}, { projectSlug: 'beta' });
    expect(() =>
      createProject(fixture.human, 'beta', {
        ...create,
        payload: { slug: 'beta', name: 'Бета', emoji: '🟢', description },
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(ordinarySnapshot(fixture)).toEqual(before);
    const update = ordinaryInput(fixture, {}, { revision: 1 });
    expect(() =>
      updateProject(fixture.human, 'alpha', { ...update, payload: { description } }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(ordinarySnapshot(fixture)).toEqual(before);
  },
);

it('rejects malformed strings and property keys with a safe root-level JSON validation issue', () => {
  for (const value of [
    invalidStrings[0],
    { nested: invalidStrings[0] },
    { [String.fromCharCode(0xd800)]: 'value' },
  ]) {
    const parsed = jsonValueSchema.safeParse(value);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.path)).toEqual([[]]);
      expect(errorEnvelope(parsed.error)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_ERROR' },
      });
    }
  }
});

it('rejects malformed description validation and rendering while preserving legitimate Unicode exactly', () => {
  const invalid = String.fromCharCode(0xd800);
  expect(descriptionSchema.safeParse(invalid).success).toBe(false);
  expect(() => renderMarkdown(invalid)).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  const source = '# 原文 👩🏽‍💻\n\ne\u0301 versus é; actual replacement character � stays unchanged.\n';
  expect(descriptionSchema.parse(source)).toBe(source);
  const result = updateTask(
    fixture.human,
    'alpha',
    taskId,
    ordinaryInput(fixture, { description: source }, { revision: 1 }),
  );
  expect(taskDetailSchema.parse(result.data).description).toBe(source);
  expect(
    fixture.connection.sqlite
      .prepare('SELECT description FROM tasks WHERE id = ?')
      .pluck()
      .get(taskId),
  ).toBe(source);
});
