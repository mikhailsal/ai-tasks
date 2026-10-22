import { randomUUID } from 'node:crypto';
import { z } from 'zod/mini';
import { beforeAll, describe, expect, it } from 'vitest';
import { createContext } from '../../src/core/context.js';
import type { CoreContext, DatabaseConnection } from '../../src/core/database/types.js';
import { successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { createApp } from '../../src/api/app.js';
import { startDataHelper } from '../../src/api/helper-client.js';
import { createMutationFixture, mutationSnapshot } from '../fixtures/mutation-seed.js';
import {
  createOrdinaryFixture,
  initialWork,
  ordinaryInput,
  ordinarySnapshot,
} from '../fixtures/ordinary-work.js';
import {
  auditRow,
  generationRow,
  insertStorageRow,
  occurrenceRow,
  taskRow,
} from '../fixtures/storage-seed.js';
const previewEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: z.strictObject({ rendered_html: z.string() }),
});
it('HTTP description preview renders hostile Markdown safely without saving any state', async () => {
  const fixture = await createMutationFixture();
  const app = createApp({ helper: await startDataHelper({ databasePath: fixture.path }) });
  try {
    const before = mutationSnapshot(fixture);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/alpha/description/preview',
      headers: {
        host: '127.0.0.1:3000',
        origin: 'http://127.0.0.1:3000',
        'content-type': 'application/json',
        'x-ai-tasks-mutation': '1',
      },
      payload: { description: '# План\n\n**Следующий шаг**\n\n<img src=x onerror=alert(1)>' },
    });
    expect(response.statusCode).toBe(200);
    const value: unknown = response.json();
    const preview = previewEnvelopeSchema.parse(value);
    expect(preview.data.rendered_html).not.toMatch(/<(?:img|script)\b/iu);
    expect(preview).toMatchObject({
      ok: true,
      data: { rendered_html: expect.stringContaining('<strong>Следующий шаг</strong>') },
    });
    expect(mutationSnapshot(fixture)).toEqual(before);
  } finally {
    await app.close();
    await fixture.close();
  }
});
type Renderer = {
  renderMarkdown(source: string): string;
  RENDER_POLICY_VERSION: number;
  refreshRenderedDescriptions(connection: DatabaseConnection): void;
};
type PreviewRuntime = {
  previewDescription(
    context: CoreContext,
    projectSlug: string,
    input: {
      description: string;
    },
  ): z.infer<typeof previewEnvelopeSchema>;
};
const rendererModule = '../../src/core/markdown/render.js';
const previewModule = '../../src/core/markdown/preview.js';
it('serves task details with the current rendering policy without changing a stale derived cache during reads', async () => {
  const fixture = await createOrdinaryFixture();
  try {
    const renderer: Renderer = await import(rendererModule);
    const { api, task } = await initialWork(fixture);
    const source = '**Исходник**\n\n<img src=x onerror=alert(1)>';
    api.updateTask(
      fixture.human,
      'alpha',
      task.id,
      ordinaryInput(fixture, { description: source }, { revision: task.revision }),
    );
    fixture.connection.sqlite
      .prepare('UPDATE tasks SET description_html=?,render_policy_version=? WHERE id=?')
      .run('<img src=x onerror=alert(1)>', renderer.RENDER_POLICY_VERSION + 1, task.id);
    const before = ordinarySnapshot(fixture);
    const detail = api.getTask(fixture.human, 'alpha', task.id);
    expect(detail.data.rendered_html).toBe(renderer.renderMarkdown(source));
    expect(detail.data.description).toBe(source);
    expect(ordinarySnapshot(fixture)).toEqual(before);
  } finally {
    await fixture.close();
  }
});
describe('shared safe Markdown rendering (production module pending T026)', () => {
  let renderer: Renderer;
  beforeAll(async () => {
    renderer = await import(rendererModule);
  });
  it('supports paragraphs, headings, emphasis, lists, links and escaped fenced code without mandatory sections', () => {
    const html = renderer.renderMarkdown(
      '# Заголовок\n\nАбзац с **жирным** и *курсивом*.\n\n- Первый\n- Второй\n\n[Ссылка](https://example.org/path)\n\n```html\n<script>alert(1)</script>\n```',
    );
    expect(html).toContain('<h1>Заголовок</h1>');
    expect(html).toContain('<strong>жирным</strong>');
    expect(html).toContain('<em>курсивом</em>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>Первый</li>');
    expect(html).toContain('href="https://example.org/path"');
    expect(html).toContain('<pre>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<script\b/iu);
    expect(renderer.renderMarkdown('Свободный текст без разделов')).toContain(
      'Свободный текст без разделов',
    );
  });
  it.each([
    '<script>alert(1)</script><style>body{display:none}</style>',
    '<img src=x onerror=alert(1)><svg onload=alert(1)></svg>',
    '<iframe src="https://evil.example"></iframe><object data="javascript:alert(1)"></object>',
    '<a href="javascript:alert(1)" onclick="alert(1)">Открыть</a>',
    '![Картинка](https://example.org/tracker.png)',
    '[Ссылка](javascript:alert%281%29)',
    '[Ссылка](data:text/html;base64,PHNjcmlwdD4=)',
    '[Ссылка](vbscript:msgbox%281%29)',
    '[Ссылка](java&#x73;cript:alert%281%29)',
  ])('removes executable content and images from %s', (source) => {
    const html = renderer.renderMarkdown(source);
    expect(html).not.toMatch(/<(?:script|style|img|svg|math|iframe|object|embed)\b/iu);
    expect(html).not.toMatch(/<[^>]+\son\w+\s*=/iu);
    expect(html).not.toMatch(/href\s*=\s*["']\s*(?:javascript|vbscript|data):/iu);
  });
  it('disables even otherwise safe raw HTML rather than treating it as authored markup', () => {
    const html = renderer.renderMarkdown('До <strong>сырой HTML</strong> после');
    expect(html).not.toContain('<strong>сырой HTML</strong>');
    expect(html).toContain('сырой HTML');
    expect(renderer.renderMarkdown('**Разметка Markdown**')).toContain(
      '<strong>Разметка Markdown</strong>',
    );
  });
  it('preserves safe HTTP and HTTPS links while accepting empty and code-point-bounded source', () => {
    const html = renderer.renderMarkdown(
      '[Первый](http://example.org) [Второй](https://example.org)',
    );
    expect(html).toContain('href="http://example.org"');
    expect(html).toContain('href="https://example.org"');
    expect(renderer.renderMarkdown('')).toBe('');
    expect(renderer.renderMarkdown('😀'.repeat(100000))).toContain('😀');
    expect(() => renderer.renderMarkdown('😀'.repeat(100001))).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });
});
describe('pure scoped description preview (production module pending T026)', () => {
  let preview: PreviewRuntime;
  beforeAll(async () => {
    preview = await import(previewModule);
  });
  it('returns the shared renderer output at the injected instant without source/state/audit/receipt changes', async () => {
    const fixture = await createMutationFixture();
    const renderer: Renderer = await import(rendererModule);
    try {
      const source = '  **План**\r\n\r\n- Сохранить исходник 😀  \r\n';
      const before = mutationSnapshot(fixture);
      const result = previewEnvelopeSchema.parse(
        preview.previewDescription(
          createContext({ connection: fixture.connection, actor: 'human-web' }),
          'alpha',
          { description: source },
        ),
      );
      expect(result.data).toEqual({ rendered_html: renderer.renderMarkdown(source) });
      expect(result.meta).toMatchObject({
        database_epoch: fixture.epoch,
        now: new Date(fixture.clock.now()).toISOString(),
      });
      expect(mutationSnapshot(fixture)).toEqual(before);
      const context = createContext({ connection: fixture.connection, actor: 'human-web' });
      expect(() =>
        preview.previewDescription(context, 'missing', { description: source }),
      ).toThrow();
      const unexpected = { description: source, reasoning: 'Undeclared extra field' };
      expect(() => preview.previewDescription(context, 'alpha', unexpected)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      );
      expect(mutationSnapshot(fixture)).toEqual(before);
    } finally {
      await fixture.close();
    }
  });
});
let renderer: Renderer;
beforeAll(async () => {
  renderer = await import(rendererModule);
});
async function cacheFixture() {
  const fixture = await createMutationFixture();
  const taskId = randomUUID();
  const parentId = randomUUID();
  const generationId = randomUUID();
  const occurrenceId = randomUUID();
  const source = '  # Исходный план\r\n\r\n**Сохранить**\r\n\r\n<img src=x onerror=alert(1)>  ';
  const stalePolicy = renderer.RENDER_POLICY_VERSION + 1;
  const unsafeCache = '<img src=x onerror=alert(1)>';
  insertStorageRow(
    fixture.connection.sqlite,
    'tasks',
    taskRow({
      id: taskId,
      description: source,
      description_html: unsafeCache,
      render_policy_version: stalePolicy,
    }),
  );
  insertStorageRow(
    fixture.connection.sqlite,
    'tasks',
    taskRow({
      id: parentId,
      kind: 'recurring',
      status_id: 'draft',
      description: source,
      description_html: unsafeCache,
      render_policy_version: stalePolicy,
    }),
  );
  insertStorageRow(
    fixture.connection.sqlite,
    'schedule_generations',
    generationRow({ id: generationId, task_id: parentId }),
  );
  insertStorageRow(
    fixture.connection.sqlite,
    'occurrences',
    occurrenceRow({
      id: occurrenceId,
      task_id: parentId,
      generation_id: generationId,
      description_snapshot: source,
      description_html_snapshot: unsafeCache,
      render_policy_version: stalePolicy,
    }),
  );
  insertStorageRow(
    fixture.connection.sqlite,
    'audit_records',
    auditRow({
      project_slug: 'alpha',
      entity_id: taskId,
      changes: JSON.stringify([{ field: 'description', before: null, after: source }]),
    }),
  );
  return { fixture, source, taskId, parentId, occurrenceId };
}
function snapshot(fixture: Awaited<ReturnType<typeof createMutationFixture>>) {
  return {
    ...mutationSnapshot(fixture),
    generations: fixture.connection.sqlite
      .prepare('SELECT * FROM schedule_generations ORDER BY id')
      .all(),
    occurrences: fixture.connection.sqlite.prepare('SELECT * FROM occurrences ORDER BY id').all(),
    configs: fixture.connection.sqlite
      .prepare('SELECT * FROM project_configs ORDER BY project_slug, revision')
      .all(),
  };
}
function semanticRows(fixture: Awaited<ReturnType<typeof createMutationFixture>>) {
  return {
    tasks: fixture.connection.sqlite
      .prepare(
        'SELECT id, project_slug, kind, title, description, emoji, emoji_key, status_id, priority, priority_scaled, deadline, revision, archived_at, created_at, updated_at FROM tasks ORDER BY id',
      )
      .all(),
    occurrences: fixture.connection.sqlite
      .prepare(
        'SELECT id, task_id, project_slug, generation_id, occurrence_key, deadline, expires_at, schedule_snapshot, miss_policy, confirmation_window_ms, description_snapshot, state, revision, actual_completed_at, completion_recorded_at, missed_at, cancelled_at, cancel_reason, created_at FROM occurrences ORDER BY id',
      )
      .all(),
  };
}
function populateCachePages(cache: Awaited<ReturnType<typeof cacheFixture>>) {
  const sqlite = cache.fixture.connection.sqlite;
  const generation = z
    .object({ id: z.string() })
    .parse(
      sqlite.prepare('SELECT id FROM schedule_generations WHERE task_id=?').get(cache.parentId),
    ).id;
  const currentTask = randomUUID();
  const currentOccurrence = randomUUID();
  sqlite.transaction(() => {
    for (let index = 0; index < 70; index++) {
      insertStorageRow(
        sqlite,
        'tasks',
        taskRow({
          description: `**Задача ${index}**`,
          description_html: '<script>stale</script>',
          render_policy_version: renderer.RENDER_POLICY_VERSION + 1,
        }),
      );
      insertStorageRow(
        sqlite,
        'occurrences',
        occurrenceRow({
          task_id: cache.parentId,
          generation_id: generation,
          occurrence_key: `calendar:${index + 1}`,
          description_snapshot: `**Событие ${index}**`,
          description_html_snapshot: '<script>stale</script>',
          render_policy_version: renderer.RENDER_POLICY_VERSION + 1,
        }),
      );
    }
    // Random UUID ordering interleaves already-current rows with the stale pages.
    insertStorageRow(
      sqlite,
      'tasks',
      taskRow({
        id: currentTask,
        description: 'Уже текущая задача',
        description_html: '<p>Current task cache</p>',
        render_policy_version: renderer.RENDER_POLICY_VERSION,
      }),
    );
    insertStorageRow(
      sqlite,
      'occurrences',
      occurrenceRow({
        id: currentOccurrence,
        task_id: cache.parentId,
        generation_id: generation,
        occurrence_key: 'calendar:current',
        description_snapshot: 'Уже текущее событие',
        description_html_snapshot: '<p>Current occurrence cache</p>',
        render_policy_version: renderer.RENDER_POLICY_VERSION,
      }),
    );
  })();
  return { currentTask, currentOccurrence };
}
describe('rendering-policy bounded page maintenance', () => {
  it('rebuilds every stale task and occurrence across multiple pages without touching current caches or semantic history', async () => {
    const cache = await cacheFixture();
    try {
      const current = populateCachePages(cache);
      const before = snapshot(cache.fixture);
      const semantic = semanticRows(cache.fixture);
      renderer.refreshRenderedDescriptions(cache.fixture.connection);
      const sqlite = cache.fixture.connection.sqlite;
      const taskRows = sqlite
        .prepare('SELECT id,description,description_html,render_policy_version FROM tasks')
        .all() as {
        id: string;
        description: string;
        description_html: string;
        render_policy_version: number;
      }[];
      const occurrenceRows = sqlite
        .prepare(
          'SELECT id,description_snapshot,description_html_snapshot,render_policy_version FROM occurrences',
        )
        .all() as {
        id: string;
        description_snapshot: string;
        description_html_snapshot: string;
        render_policy_version: number;
      }[];
      expect(taskRows.length).toBeGreaterThan(70);
      expect(occurrenceRows).toHaveLength(72);
      for (const row of taskRows) {
        expect(row.render_policy_version).toBe(renderer.RENDER_POLICY_VERSION);
        if (row.id === current.currentTask)
          expect(row.description_html).toBe('<p>Current task cache</p>');
        else if (
          row.description.startsWith('**Задача') ||
          row.id === cache.taskId ||
          row.id === cache.parentId
        )
          expect(row.description_html).toBe(renderer.renderMarkdown(row.description));
      }
      for (const row of occurrenceRows) {
        expect(row.render_policy_version).toBe(renderer.RENDER_POLICY_VERSION);
        expect(row.description_html_snapshot).toBe(
          row.id === current.currentOccurrence
            ? '<p>Current occurrence cache</p>'
            : renderer.renderMarkdown(row.description_snapshot),
        );
      }
      expect(semanticRows(cache.fixture)).toEqual(semantic);
      const after = snapshot(cache.fixture);
      expect(after.audits).toEqual(before.audits);
      expect(after.receipts).toEqual(before.receipts);
      expect(after.configs).toEqual(before.configs);
      expect(after.generations).toEqual(before.generations);
      renderer.refreshRenderedDescriptions(cache.fixture.connection);
      expect(snapshot(cache.fixture)).toEqual(after);
    } finally {
      await cache.fixture.close();
    }
  });
  it('rolls back all task and earlier occurrence pages when a late occurrence page fails', async () => {
    const cache = await cacheFixture();
    try {
      populateCachePages(cache);
      const sqlite = cache.fixture.connection.sqlite;
      let attempts = 0;
      sqlite.function('reject_late_render_page', () => {
        attempts++;
        if (attempts === 65) throw new Error('Injected late-page rendering failure');
        return 1;
      });
      sqlite.exec(
        `CREATE TEMP TRIGGER reject_late_render_cache BEFORE UPDATE OF description_html_snapshot,render_policy_version ON occurrences BEGIN SELECT reject_late_render_page(); END;`,
      );
      const before = snapshot(cache.fixture);
      expect(() => renderer.refreshRenderedDescriptions(cache.fixture.connection)).toThrow();
      expect(attempts).toBe(65);
      expect(snapshot(cache.fixture)).toEqual(before);
    } finally {
      await cache.fixture.close();
    }
  });
});
describe('rendering-policy derived cache maintenance', () => {
  it('rebuilds mismatched policy caches while preserving source, frozen conditions, revisions and immutable history; reruns are idempotent', async () => {
    const { fixture, source, taskId, parentId, occurrenceId } = await cacheFixture();
    try {
      expect(Number.isInteger(renderer.RENDER_POLICY_VERSION)).toBe(true);
      expect(renderer.RENDER_POLICY_VERSION).toBeGreaterThan(0);
      const before = snapshot(fixture);
      const semantic = semanticRows(fixture);
      renderer.refreshRenderedDescriptions(fixture.connection);
      const expected = renderer.renderMarkdown(source);
      expect(expected).not.toMatch(/<img\b/iu);
      for (const id of [taskId, parentId]) {
        expect(
          fixture.connection.sqlite
            .prepare(
              'SELECT description, description_html, render_policy_version FROM tasks WHERE id = ?',
            )
            .get(id),
        ).toEqual({
          description: source,
          description_html: expected,
          render_policy_version: renderer.RENDER_POLICY_VERSION,
        });
      }
      expect(
        fixture.connection.sqlite
          .prepare(
            'SELECT description_snapshot, description_html_snapshot, render_policy_version FROM occurrences WHERE id = ?',
          )
          .get(occurrenceId),
      ).toEqual({
        description_snapshot: source,
        description_html_snapshot: expected,
        render_policy_version: renderer.RENDER_POLICY_VERSION,
      });
      expect(semanticRows(fixture)).toEqual(semantic);
      const after = snapshot(fixture);
      expect(after.audits).toEqual(before.audits);
      expect(after.receipts).toEqual(before.receipts);
      expect(after.generations).toEqual(before.generations);
      expect(after.configs).toEqual(before.configs);
      renderer.refreshRenderedDescriptions(fixture.connection);
      expect(snapshot(fixture)).toEqual(after);
    } finally {
      await fixture.close();
    }
  });
  it('rolls back all cache writes when an occurrence update fails inside the rebuild', async () => {
    const { fixture } = await cacheFixture();
    try {
      let rejected = false;
      fixture.connection.sqlite.function('reject_render_rebuild', () => {
        rejected = true;
        throw new Error('Test rendering-cache rejection');
      });
      fixture.connection.sqlite.exec(`CREATE TEMP TRIGGER reject_render_cache
        BEFORE UPDATE OF description_html_snapshot, render_policy_version ON occurrences
        BEGIN SELECT reject_render_rebuild(); END;`);
      const before = snapshot(fixture);
      expect(() => renderer.refreshRenderedDescriptions(fixture.connection)).toThrow();
      expect(rejected).toBe(true);
      expect(snapshot(fixture)).toEqual(before);
    } finally {
      await fixture.close();
    }
  });
});
