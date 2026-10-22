import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createContext } from '../../src/core/context.js';
import { executeMutation } from '../../src/core/database/mutate.js';
import type { DatabaseTransaction } from '../../src/core/database/types.js';
import { projects, tasks } from '../../src/schema/entities.js';
import {
  createMutationFixture,
  mutationSnapshot,
  type MutationFixture,
} from '../fixtures/mutation-seed.js';
import { insertStorageRow } from '../fixtures/storage-seed.js';

type NormalizedEmoji = { emoji: string; key: string };
type EmojiRuntime = {
  normalizeEmoji(value: unknown): NormalizedEmoji;
  reserveProjectEmoji(
    transaction: DatabaseTransaction,
    options: {
      projectSlug: string;
      emoji: string;
      now: number;
    },
  ): unknown;
  syncTaskEmoji(
    transaction: DatabaseTransaction,
    options: {
      projectSlug: string;
      taskId: string;
      emoji: string;
      reserve: boolean;
      collision?: 'reject' | 'use_default';
    },
  ): NormalizedEmoji;
};
// T025 owns this production module. Deferred loading lets the separate HTTP preview
// assertion run against today's compiled application before these helpers exist.
const emojiModule = '../../src/core/tasks/emoji.js';
let emoji: EmojiRuntime;
beforeAll(async () => {
  emoji = await import(emojiModule);
});

describe('one RGI emoji grapheme and presentation identity', () => {
  it.each(['😀', '👩🏽‍💻', '👨‍👩‍👧‍👦', '🇯🇵', '👍🏿', '1️⃣', '🏳️‍🌈'])(
    'preserves the complete valid RGI sequence %s',
    (value) => {
      expect(emoji.normalizeEmoji(value)).toEqual({
        emoji: value.normalize('NFC'),
        key: value.replace(/[\uFE0E\uFE0F]/gu, ''),
      });
    },
  );
  it('normalizes display to NFC and removes only selectors from comparison keys', () => {
    for (const value of ['✈', '✈️', '✈︎']) {
      expect(emoji.normalizeEmoji(value)).toEqual({ emoji: value.normalize('NFC'), key: '✈' });
    }
    expect(emoji.normalizeEmoji('👩🏽‍💻').key).toBe('👩🏽‍💻');
    expect(emoji.normalizeEmoji('👍').key).not.toBe(emoji.normalizeEmoji('👍🏽').key);
    expect(emoji.normalizeEmoji('👩‍💻').key).not.toBe(emoji.normalizeEmoji('👩‍🔬').key);
  });
  it.each(['', 'hello', 'e\u0301', '😀😀', '😀 ', 'x😀', '🏽', '🇯', '😀‍😀', '<img>', null, 1])(
    'rejects non-RGI or multiple-grapheme input %j',
    (value) => {
      expect(() => emoji.normalizeEmoji(value)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      );
    },
  );
});

let fixture: MutationFixture;

function snapshot() {
  return {
    ...mutationSnapshot(fixture),
    projectReservations: fixture.connection.sqlite
      .prepare('SELECT * FROM project_emoji_reservations ORDER BY emoji_key')
      .all(),
  };
}
function reserveProject(projectSlug: string, value: string) {
  return fixture.connection.db.transaction((transaction) =>
    emoji.reserveProjectEmoji(transaction, {
      projectSlug,
      emoji: value,
      now: fixture.clock.now(),
    }),
  );
}
function assignTask(options: {
  emoji: string;
  taskId?: string;
  projectSlug?: string;
  reserve?: boolean;
  collision?: 'reject' | 'use_default';
  kind?: 'ordinary' | 'recurring';
  status?: string;
  archivedAt?: number | null;
}) {
  const projectSlug = options.projectSlug ?? 'alpha';
  const id = options.taskId ?? randomUUID();
  const previous = fixture.connection.db.select().from(tasks).where(eq(tasks.id, id)).get();
  return executeMutation({
    context: createContext({ connection: fixture.connection, actor: 'human-web' }),
    projectSlug,
    operation: previous ? 'test.task.edit_emoji' : 'test.task.create',
    input: {
      operation_id: randomUUID(),
      database_epoch: fixture.epoch,
      expected_config_revision: 1,
      expected_settings_revision: 1,
      ...(previous ? { expected_revision: previous.revision } : {}),
      payload: { emoji: options.emoji },
    },
    ...(previous ? { guards: { entity: { type: 'task' as const, id } } } : {}),
    handler(transaction, now) {
      if (!previous)
        transaction
          .insert(tasks)
          .values({
            id,
            projectSlug,
            kind: options.kind ?? 'ordinary',
            title: 'Маркер задачи',
            statusId: options.status ?? 'idea',
            createdAt: now,
            updatedAt: now,
          })
          .run();
      const normalized = emoji.syncTaskEmoji(transaction, {
        projectSlug,
        taskId: id,
        emoji: options.emoji,
        reserve: options.reserve ?? true,
        ...(options.collision ? { collision: options.collision } : {}),
      });
      transaction
        .update(tasks)
        .set({
          emoji: normalized.emoji,
          emojiKey: normalized.key,
          statusId: options.status ?? previous?.statusId ?? 'idea',
          archivedAt: options.archivedAt ?? null,
          revision: previous ? previous.revision + 1 : 1,
          updatedAt: now,
        })
        .where(eq(tasks.id, id))
        .run();
      return {
        data: { id, emoji: normalized.emoji },
        events: [
          {
            entity_type: 'task',
            entity_id: id,
            action: 'emoji_assigned',
            changes: [{ field: 'emoji', before: previous?.emoji ?? null, after: normalized.emoji }],
          },
        ],
      };
    },
  });
}
function createdId(result: ReturnType<typeof assignTask>): string {
  if (
    typeof result.data !== 'object' ||
    result.data === null ||
    Array.isArray(result.data) ||
    typeof result.data.id !== 'string'
  )
    throw new Error('Expected created task ID');
  return result.data.id;
}

describe('transaction-bound project and task emoji reservations', () => {
  beforeEach(async () => {
    fixture = await createMutationFixture();
    reserveProject('alpha', '🔵');
    reserveProject('beta', '🟢');
  });
  afterEach(async () => {
    await fixture?.close();
  });

  it('allows repeatable default task markers but never a default project marker', () => {
    assignTask({ emoji: '⚪' });
    assignTask({ emoji: '⚪️' });
    expect(
      fixture.connection.sqlite.prepare('SELECT * FROM task_emoji_reservations').all(),
    ).toEqual([]);
    expect(() => reserveProject('alpha', '⚪')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });
  it('reserves nondefault markers within each project and treats selectors as the same marker', () => {
    assignTask({ emoji: '✈️' });
    assignTask({ emoji: '✈︎', projectSlug: 'beta' });
    const before = snapshot();
    expect(() => assignTask({ emoji: '✈' })).toThrow(
      expect.objectContaining({ code: 'EMOJI_CONFLICT' }),
    );
    expect(snapshot()).toEqual(before);
  });
  it('moves a successful edited task reservation and frees its previous key', () => {
    const edited = createdId(assignTask({ emoji: '🧰' }));
    assignTask({ taskId: edited, emoji: '📚' });
    assignTask({ emoji: '🧰' });
    const before = snapshot();
    expect(() => assignTask({ emoji: '📚' })).toThrow(
      expect.objectContaining({ code: 'EMOJI_CONFLICT' }),
    );
    expect(snapshot()).toEqual(before);
  });
  it('rejects create and edit collisions without fallback or state/audit/receipt changes', () => {
    assignTask({ emoji: '🧰' });
    const edited = createdId(assignTask({ emoji: '📚' }));
    for (const taskId of [undefined, edited]) {
      const before = snapshot();
      expect(() => assignTask({ emoji: '🧰', ...(taskId ? { taskId } : {}) })).toThrow(
        expect.objectContaining({ code: 'EMOJI_CONFLICT' }),
      );
      expect(snapshot()).toEqual(before);
    }
  });
  it.each(['done', 'cancelled', 'archived'])(
    'releases an ordinary %s marker and supports explicit reject or audited default on return',
    (status) => {
      const original = createdId(assignTask({ emoji: '🧰' }));
      assignTask({
        taskId: original,
        emoji: '🧰',
        reserve: false,
        status: status === 'archived' ? 'idea' : status,
        ...(status === 'archived' ? { archivedAt: fixture.clock.now() } : {}),
      });
      assignTask({ emoji: '🧰' });
      const before = snapshot();
      expect(() =>
        assignTask({ taskId: original, emoji: '🧰', collision: 'reject', status: 'idea' }),
      ).toThrow(expect.objectContaining({ code: 'EMOJI_CONFLICT' }));
      expect(snapshot()).toEqual(before);
      const returned = assignTask({
        taskId: original,
        emoji: '🧰',
        collision: 'use_default',
        status: 'idea',
      });
      expect(returned.data).toMatchObject({ id: original, emoji: '⚪' });
      const auditId = returned.meta.audit_ids[0];
      expect(
        fixture.connection.sqlite
          .prepare('SELECT changes FROM audit_records WHERE id = ?')
          .pluck()
          .get(auditId),
      ).toContain('⚪');
    },
  );
  it.each(['draft', 'active', 'paused'])('retains a recurring %s parent reservation', (status) => {
    assignTask({ emoji: '🧰', kind: 'recurring', status, reserve: true });
    const before = snapshot();
    expect(() => assignTask({ emoji: '🧰' })).toThrow(
      expect.objectContaining({ code: 'EMOJI_CONFLICT' }),
    );
    expect(snapshot()).toEqual(before);
  });
  it('retains former project markers permanently and permits idempotent reservation by the same owner', () => {
    reserveProject('alpha', '🛰️');
    const first = snapshot().projectReservations;
    fixture.clock.advanceBy(1_000);
    reserveProject('alpha', '🛰');
    expect(snapshot().projectReservations).toEqual(first);
    reserveProject('alpha', '🧿');
    fixture.connection.db
      .update(projects)
      .set({ emoji: '🧿', emojiKey: '🧿' })
      .where(eq(projects.slug, 'alpha'))
      .run();
    const before = snapshot();
    expect(() => reserveProject('beta', '🛰')).toThrow(
      expect.objectContaining({ code: 'EMOJI_CONFLICT' }),
    );
    expect(() => assignTask({ emoji: '🛰', reserve: false })).toThrow(
      expect.objectContaining({ code: 'EMOJI_CONFLICT' }),
    );
    expect(snapshot()).toEqual(before);
  });
  it('rejects a project marker matching any stored completed/archived task in another project', () => {
    assignTask({
      emoji: '🧰',
      projectSlug: 'beta',
      reserve: false,
      status: 'done',
      archivedAt: fixture.clock.now(),
    });
    const before = snapshot();
    expect(() => reserveProject('alpha', '🧰')).toThrow(
      expect.objectContaining({ code: 'EMOJI_CONFLICT' }),
    );
    expect(snapshot()).toEqual(before);
  });
  it('respects permanent markers whose historical project owner is absent after restore', () => {
    insertStorageRow(fixture.connection.sqlite, 'project_emoji_reservations', {
      emoji_key: '🛰',
      emoji: '🛰️',
      project_slug: 'absent-former-owner',
      first_reserved_at: fixture.clock.now(),
    });
    const before = snapshot();
    expect(() => reserveProject('alpha', '🛰')).toThrow(
      expect.objectContaining({ code: 'EMOJI_CONFLICT' }),
    );
    expect(() => assignTask({ emoji: '🛰️', projectSlug: 'beta' })).toThrow(
      expect.objectContaining({ code: 'EMOJI_CONFLICT' }),
    );
    expect(snapshot()).toEqual(before);
  });
  it('rolls back reservation changes together with the enclosing failed mutation', () => {
    const before = snapshot();
    expect(() =>
      fixture.connection.db.transaction((transaction) => {
        emoji.reserveProjectEmoji(transaction, {
          projectSlug: 'alpha',
          emoji: '🧰',
          now: fixture.clock.now(),
        });
        throw new Error('Reject remaining projected state');
      }),
    ).toThrow('Reject remaining projected state');
    expect(snapshot()).toEqual(before);
  });
});
