import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { getProject } from '../../src/core/queries/projects.js';
import { getProjectConfiguration } from '../../src/core/queries/configuration.js';
import { getTask } from '../../src/core/queries/tasks.js';
import { getSettings } from '../../src/core/projects/settings.js';
import { createTask, updateTask } from '../../src/core/tasks/commands.js';
import { mutationEnvelopeSchema } from '../../src/schema/envelopes.js';
import type { JsonValue } from '../../src/schema/values.js';
import { blankRecurrenceFields } from '../../web/src/screens/recurrence-fields.js';
import {
  activate,
  createRecurring,
  dayMs,
  generationFixture,
  readContext,
  rule,
} from '../fixtures/recurrence-generations.js';
import type { OrdinaryFixture } from '../fixtures/ordinary-work.js';
let fixture: OrdinaryFixture | undefined;
afterEach(() => fixture?.close());
function taskPage(current: OrdinaryFixture, id?: string) {
  const context = readContext(current);
  const project = getProject(context, 'alpha');
  const configuration = getProjectConfiguration(context, 'alpha');
  const settings = getSettings(context, { project_slug: 'alpha' });
  return {
    project: project.data,
    configuration: configuration.data,
    task: id ? getTask(context, 'alpha', id).data : null,
    epoch: project.meta.database_epoch,
    timezone: settings.data.timezone,
    settingsRevision: settings.data.revision,
  };
}
type Page = ReturnType<typeof taskPage>;
type Fields = Record<string, JsonValue>;
async function taskModel() {
  // String-path import keeps browser-only transport DOM types out of the Node test project.
  // These are the actual production model callables, exercised against production storage.
  const path = '../../web/src/screens/task-model.js';
  const loaded: unknown = await import(path);
  return z
    .object({
      fieldsFromPage: z.custom<(page: Page) => Fields>((value) => typeof value === 'function'),
      baseFromPage: z.custom<(page: Page) => Record<string, JsonValue>>(
        (value) => typeof value === 'function',
      ),
      taskPayload: z.custom<(fields: Fields, page: Page) => JsonValue>(
        (value) => typeof value === 'function',
      ),
      taskFieldsSchema: z.custom<z.ZodMiniType<Fields>>((value) => value instanceof z.ZodMiniType),
    })
    .parse(loaded);
}
function envelope(model: Awaited<ReturnType<typeof taskModel>>, page: Page, fields: Fields) {
  return mutationEnvelopeSchema.parse({
    ...model.baseFromPage(page),
    operation_id: randomUUID(),
    payload: model.taskPayload(fields, page),
  });
}
function frozenStorage(current: OrdinaryFixture, id: string) {
  return ['schedule_generations', 'recurrence_state', 'recurrence_intervals', 'occurrences'].map(
    (table) =>
      current.connection.sqlite
        .prepare(`SELECT * FROM ${table} WHERE task_id=? ORDER BY rowid`)
        .all(id),
  );
}
it('creates recurring tasks from the real browser fields and guards without a user deadline', async () => {
  const current = await generationFixture();
  fixture = current;
  const model = await taskModel();
  const page = taskPage(current);
  const fields = {
    ...model.fieldsFromPage(page),
    title: 'Повторение из формы',
    kind: 'recurring',
    recurrence: {
      ...blankRecurrenceFields(),
      first: { date: '2026-10-23', time: '13:02:03.123', offset: '' },
      localTime: '13:02:03.123',
      missPolicy: 'record_miss',
      confirmationWindowMs: '0',
    },
  };
  const input = envelope(model, page, fields);
  expect(input.expected_settings_revision).toBe(1);
  expect(input.payload).not.toHaveProperty('deadline');
  const result = createTask(current.human, 'alpha', input);
  const id = z.object({ id: z.uuid() }).parse(result.data).id;
  expect(getTask(readContext(current), 'alpha', id).data).toMatchObject({
    kind: 'recurring',
    title: fields.title,
    deadline: null,
    recurrence: {
      first_deadline: '2026-10-23T10:02:03.123Z',
      miss_policy: 'record_miss',
      confirmation_window_ms: 0,
    },
  });
});
it('browser recurring content edits omit timing and leave generations and frozen occurrence source unchanged', async () => {
  const current = await generationFixture();
  fixture = current;
  const id = createRecurring(current, rule(current.clock.now() + dayMs));
  await activate(current, id);
  const before = frozenStorage(current, id);
  const model = await taskModel();
  const page = taskPage(current, id);
  const fields = {
    ...model.fieldsFromPage(page),
    title: 'Новое название',
    description: '# Новый исходник  \n',
    deadline: { date: '2099-01-01', time: '00:00', offset: '' },
  };
  const input = envelope(model, page, fields);
  for (const key of ['deadline', 'kind', 'recurrence'])
    expect(input.payload).not.toHaveProperty(key);
  updateTask(current.human, 'alpha', id, input);
  expect(getTask(readContext(current), 'alpha', id).data).toMatchObject({
    title: fields.title,
    description: fields.description,
  });
  expect(frozenStorage(current, id)).toEqual(before);
});
it('legacy ordinary drafts acquire explicit empty recurrence choices and preserve ordinary deadline precision', async () => {
  const current = await generationFixture();
  fixture = current;
  const model = await taskModel();
  const page = taskPage(current);
  const legacy = {
    title: 'Старый черновик',
    description: '**Исходник**',
    emoji: '⚪',
    priority: null,
    timezone: 'Europe/Moscow',
    deadline: { date: '2026-10-23', time: '17:21:34.987', offset: '' },
  };
  const fields = model.taskFieldsSchema.parse(legacy);
  expect(fields).toMatchObject({
    kind: 'ordinary',
    recurrence: { missPolicy: '', confirmationWindowMs: '' },
  });
  const input = envelope(model, page, fields);
  expect(input.payload).not.toHaveProperty('recurrence');
  const created = createTask(current.human, 'alpha', input);
  const id = z.object({ id: z.uuid() }).parse(created.data).id;
  expect(getTask(readContext(current), 'alpha', id).data).toMatchObject({
    kind: 'ordinary',
    deadline: '2026-10-23T14:21:34.987Z',
    description: legacy.description,
  });
});
