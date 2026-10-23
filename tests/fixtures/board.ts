import { z } from 'zod/mini';
import { readBoardColumn } from '../../src/core/queries/board.js';
import { moveBoardTask } from '../../src/core/tasks/board.js';
import { createTask } from '../../src/core/tasks/commands.js';
import { boardColumnEnvelopeSchema } from '../../src/schema/board.js';
import { taskDetailSchema } from '../../src/schema/tasks.js';
import type { JsonValue } from '../../src/schema/values.js';
import {
  initialWork,
  ordinaryInput,
  ordinarySnapshot,
  type OrdinaryFixture,
} from './ordinary-work.js';
export async function boardWork(fixture: OrdinaryFixture) {
  const work = await initialWork(fixture);
  const create = (title: string, extra: Record<string, JsonValue> = {}) =>
    taskDetailSchema.parse(
      createTask(
        fixture.human,
        'alpha',
        ordinaryInput(fixture, { kind: 'ordinary', title, ...extra }),
      ).data,
    );
  const second = create('Вторая', { priority: { model: 'classic', level: 'critical' } });
  const third = create('Третья');
  return { ...work, second, third, create };
}
export function boardColumn(
  fixture: OrdinaryFixture,
  status = 'idea',
  extra: Record<string, JsonValue> = {},
) {
  return boardColumnEnvelopeSchema.parse(
    readBoardColumn(fixture.human, {
      project_slug: 'alpha',
      kind: 'ordinary',
      status_id: status,
      include_terminal: true,
      ...extra,
    }),
  );
}
export function boardSnapshot(fixture: OrdinaryFixture) {
  return {
    ...ordinarySnapshot(fixture),
    board_order: fixture.connection.sqlite
      .prepare('SELECT * FROM board_order ORDER BY task_id')
      .all(),
    board_columns: fixture.connection.sqlite
      .prepare('SELECT * FROM board_columns ORDER BY project_slug,kind,status_id')
      .all(),
  };
}
export function boardInput(
  fixture: OrdinaryFixture,
  taskId: string,
  toStatus = 'idea',
  position: string | null | Record<string, JsonValue> = null,
) {
  const task = z
    .object({
      kind: z.enum(['ordinary', 'recurring']),
      status_id: z.string(),
      revision: z.number(),
    })
    .parse(
      fixture.connection.sqlite
        .prepare('SELECT kind,status_id,revision FROM tasks WHERE id=?')
        .get(taskId),
    );
  const revision = (status: string) =>
    z
      .object({ revision: z.number() })
      .parse(
        fixture.connection.sqlite
          .prepare(
            'SELECT coalesce((SELECT revision FROM board_columns WHERE project_slug=? AND kind=? AND status_id=?),1) AS revision',
          )
          .get('alpha', task.kind, status),
      ).revision;
  return ordinaryInput(
    fixture,
    {
      to_status_id: toStatus,
      before_task_id: typeof position === 'object' ? null : position,
      expected_source_order_revision: revision(task.status_id),
      expected_destination_order_revision: revision(toStatus),
      ...(typeof position === 'object' && position !== null ? position : {}),
    },
    { revision: task.revision },
  );
}
export function boardMove(
  fixture: OrdinaryFixture,
  taskId: string,
  toStatus = 'idea',
  beforeTaskId: string | null = null,
) {
  return moveBoardTask(
    fixture.human,
    'alpha',
    taskId,
    boardInput(fixture, taskId, toStatus, beforeTaskId),
  );
}
