import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod/mini';
import { getProjectConfiguration } from '../../src/core/queries/configuration.js';
import { jsonValueSchema } from '../../src/schema/values.js';
import {
  createOrdinaryFixture,
  ordinarySnapshot,
  preparedMutation,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';
let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
});
afterEach(() => fixture?.close());
const projectCommands = ['project-update', 'project-archive', 'project-restore'] as const;
it.each(projectCommands)(
  '%s rejects a fresh command attributed to another CLI project',
  async (kind) => {
    const { input, invoke } = await preparedMutation(fixture, kind);
    const before = ordinarySnapshot(fixture);
    expect(() => invoke(fixture.agent('beta'), input)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(ordinarySnapshot(fixture)).toEqual(before);
  },
);
it.each(projectCommands)(
  '%s rejects payload scope, slug and technical ID edits atomically',
  async (kind) => {
    const { input, invoke } = await preparedMutation(fixture, kind);
    const payload = z.record(z.string(), jsonValueSchema).parse(input.payload);
    const before = ordinarySnapshot(fixture);
    for (const edit of [{ project_slug: 'beta' }, { slug: 'beta' }, { id: randomUUID() }]) {
      expect(() =>
        invoke(fixture.human, { ...input, payload: { ...payload, ...edit } }),
      ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
      expect(ordinarySnapshot(fixture)).toEqual(before);
    }
  },
);
it.each(['project-archive', 'project-restore'] as const)(
  '%s rejects foreign children and stale child revisions without changing the project',
  async (kind) => {
    const { input, invoke } = await preparedMutation(fixture, kind);
    const payload = z
      .object({
        affected_tasks: z.array(z.object({ task_id: z.string(), expected_revision: z.number() })),
      })
      .parse(input.payload);
    const foreign = z
      .object({ id: z.string(), revision: z.number() })
      .parse(
        fixture.connection.sqlite
          .prepare("SELECT id, revision FROM tasks WHERE project_slug = 'beta'")
          .get(),
      );
    const before = ordinarySnapshot(fixture);
    const attempts = [
      {
        affected_tasks: [
          ...payload.affected_tasks,
          { task_id: foreign.id, expected_revision: foreign.revision },
        ],
        code: 'PROJECT_MISMATCH',
      },
      {
        affected_tasks: payload.affected_tasks.map((task) => ({ ...task, expected_revision: 99 })),
        code: 'REVISION_CONFLICT',
      },
    ];
    for (const attempt of attempts) {
      expect(() =>
        invoke(fixture.human, { ...input, payload: { affected_tasks: attempt.affected_tasks } }),
      ).toThrowError(expect.objectContaining({ code: attempt.code }));
      expect(ordinarySnapshot(fixture)).toEqual(before);
    }
  },
);
it.each(projectCommands)(
  '%s persists exact semantic changes, configuration meanings and receipt',
  async (kind) => {
    const { input, invoke } = await preparedMutation(fixture, kind);
    const configuration = getProjectConfiguration(fixture.human, 'alpha').data;
    const result = invoke(fixture.human, input);
    expect(result.meta.audit_ids).toHaveLength(1);
    const row = z
      .object({
        project_slug: z.string(),
        entity_type: z.string(),
        actor: z.string(),
        action: z.string(),
        config_snapshot: z.string(),
        changes: z.string(),
      })
      .parse(
        fixture.connection.sqlite
          .prepare(
            'SELECT project_slug, entity_type, actor, action, config_snapshot, changes FROM audit_records WHERE id = ?',
          )
          .get(result.meta.audit_ids[0]),
      );
    expect(row).toMatchObject({
      project_slug: 'alpha',
      entity_type: 'project',
      actor: 'human-web',
      action: kind.replace('-', '.'),
    });
    expect(JSON.parse(row.config_snapshot)).toEqual(configuration);
    const changes = z
      .array(z.object({ field: z.string(), before: z.unknown(), after: z.unknown() }))
      .parse(JSON.parse(row.changes));
    if (kind === 'project-update') {
      expect(changes).toEqual(
        expect.arrayContaining([
          { field: 'name', before: 'Альфа', after: 'Новое имя' },
          { field: 'priority', before: 0, after: 7 },
        ]),
      );
    } else {
      const now = new Date(fixture.clock.now()).toISOString();
      expect(changes).toContainEqual({
        field: 'archived_at',
        before: kind === 'project-archive' ? null : now,
        after: kind === 'project-archive' ? now : null,
      });
    }
    const receipt = z
      .object({ result: z.string() })
      .parse(
        fixture.connection.sqlite
          .prepare('SELECT result FROM operation_receipts WHERE operation_id = ?')
          .get(input.operation_id),
      );
    expect(JSON.parse(receipt.result)).toEqual(result);
  },
);
