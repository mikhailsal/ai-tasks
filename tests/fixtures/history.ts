import { randomUUID } from 'node:crypto';
import { z } from 'zod/mini';
import { createTask, updateTask } from '../../src/core/tasks/commands.js';
import { transitionTask } from '../../src/core/tasks/transitions.js';
import { migrateConfiguration } from '../../src/core/projects/configuration.js';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import type { CoreContext } from '../../src/core/database/types.js';
import { successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { jsonValueSchema, timestampSchema } from '../../src/schema/values.js';
import { taskDetailSchema } from '../../src/schema/tasks.js';
import { configurationSnapshot } from './configuration.js';
import { ordinaryInput, type OrdinaryFixture } from './ordinary-work.js';
export const auditItemSchema = z.object({
  id: z.uuid(),
  operation_id: z.uuid(),
  project_slug: z.string(),
  entity_type: z.string(),
  entity_id: z.uuid(),
  actor: z.string(),
  origin: z.string(),
  timestamp: timestampSchema,
  action: z.string(),
  changes: z.array(
    z.object({ field: z.string(), before: jsonValueSchema, after: jsonValueSchema }),
  ),
  config_snapshot: jsonValueSchema,
  config_revision: z.nullable(z.number()),
  confirmation: jsonValueSchema,
  database_epoch: z.uuid(),
});
const auditPageSchema = z.extend(successEnvelopeSchema, {
  data: z.object({
    items: z.array(auditItemSchema),
    next_cursor: z.nullable(z.string()),
  }),
});
export async function historyApi() {
  const source = '../../src/core/queries/audit.js';
  const loaded: unknown = await import(source);
  const api = z
    .object({
      listAudit: z.custom<
        (context: Pick<CoreContext, 'connection' | 'now'>, input: unknown) => unknown
      >((value) => typeof value === 'function'),
    })
    .parse(loaded);
  return (context: Pick<CoreContext, 'connection' | 'now'>, input: unknown) =>
    auditPageSchema.parse(api.listAudit(context, input));
}
export function historySnapshot(fixture: OrdinaryFixture) {
  return configurationSnapshot(fixture);
}
export function createHistoryTask(fixture: OrdinaryFixture) {
  return taskDetailSchema.parse(
    createTask(
      fixture.human,
      'alpha',
      ordinaryInput(fixture, {
        kind: 'ordinary',
        title: 'История задачи',
        description: '  Старый **план** 👩🏽‍💻\n',
      }),
    ).data,
  );
}
export function seedHistoryPages(fixture: OrdinaryFixture, count = 55) {
  let task = createHistoryTask(fixture);
  for (let index = 0; index < count; index += 1) {
    if (index % 3 === 0) fixture.clock.advanceBy(1);
    task = taskDetailSchema.parse(
      updateTask(
        fixture.agent('alpha'),
        'alpha',
        task.id,
        ordinaryInput(fixture, { title: `Шаг ${index}` }, { revision: task.revision }),
      ).data,
    );
  }
  return task;
}
export function historicalConsent(fixture: OrdinaryFixture) {
  let task = createHistoryTask(fixture);
  const oldSource = task.description;
  const newSource = '  Новый **план** 👩🏽‍💻\n\n';
  const descriptionUpdate = updateTask(
    fixture.agent('alpha'),
    'alpha',
    task.id,
    ordinaryInput(fixture, { description: newSource }, { revision: task.revision }),
  );
  task = taskDetailSchema.parse(descriptionUpdate.data);
  for (const status of ['planning', 'ready', 'in_progress', 'sanity_check']) {
    task = taskDetailSchema.parse(
      transitionTask(
        fixture.human,
        'alpha',
        task.id,
        ordinaryInput(fixture, { to_status_id: status }, { revision: task.revision }),
      ).data,
    );
  }
  const confirmation = {
    asserted: true,
    user_text: '  Пользователь проверил именно этот переход 👩🏽‍💻\n',
  };
  const completed = transitionTask(
    fixture.human,
    'alpha',
    task.id,
    ordinaryInput(fixture, { to_status_id: 'done', confirmation }, { revision: task.revision }),
  );
  const previous = createDefaultProjectConfig();
  const config = structuredClone(previous);
  config.ordinary_workflow.statuses = config.ordinary_workflow.statuses.map((status) =>
    status.id === 'done'
      ? { ...status, id: 'fulfilled', label: 'Другое сегодняшнее название', color: 'rose' }
      : status,
  );
  config.ordinary_workflow.transitions = config.ordinary_workflow.transitions.map((edge) => ({
    ...edge,
    from: edge.from === 'done' ? 'fulfilled' : edge.from,
    to: edge.to === 'done' ? 'fulfilled' : edge.to,
  }));
  const completedTask = taskDetailSchema.parse(completed.data);
  migrateConfiguration(
    fixture.human,
    'alpha',
    ordinaryInput(
      fixture,
      jsonValueSchema.parse({
        config,
        status_mappings: [{ kind: 'ordinary', from_status_id: 'done', to_status_id: 'fulfilled' }],
        priority_mappings: [],
        affected_tasks: [{ task_id: completedTask.id, expected_revision: completedTask.revision }],
      }),
      { revision: 1 },
    ),
  );
  return {
    task,
    completed,
    confirmation,
    previous,
    config,
    descriptionUpdate,
    oldSource,
    newSource,
  };
}
export function seedAbsentProjectHistory(
  fixture: OrdinaryFixture,
  capturedRevision: number | null = 7,
) {
  const id = randomUUID();
  const operationId = randomUUID();
  const entityId = randomUUID();
  const epoch = randomUUID();
  const snapshot =
    capturedRevision === null
      ? null
      : { revision: capturedRevision, ...createDefaultProjectConfig() };
  const changes = [
    { field: 'description', before: 'Прошлый текст', after: 'Исторический текст\n' },
  ];
  fixture.connection.sqlite
    .prepare(
      `INSERT INTO audit_records
    (id,operation_id,project_slug,entity_type,entity_id,actor,origin,timestamp,action,changes,config_snapshot,confirmation,database_epoch)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      operationId,
      'former-project',
      'task',
      entityId,
      'ai-cli:former-project',
      'cli',
      fixture.clock.now(),
      'task.update',
      JSON.stringify(changes),
      JSON.stringify(snapshot),
      null,
      epoch,
    );
  return { id, operationId, entityId, epoch, snapshot, changes };
}
