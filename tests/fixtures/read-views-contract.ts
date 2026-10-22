import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/api/app.js';
import { createProject } from '../../src/core/projects/commands.js';
import { responseEnvelopeSchema } from '../../src/schema/envelopes.js';
import type { JsonValue } from '../../src/schema/values.js';
import { createOrdinaryFixture, ordinaryInput } from './ordinary-work.js';
import { seedReadViews, readViewsSnapshot, type ReadViewSeedOptions } from './read-views.js';
import { availablePort } from './http-delivery.js';
import { createLazyDataHelper } from './lazy-data-helper.js';

export type ReadView = 'agenda' | 'priorities' | 'stats';
export type ViewScope = { project_slug: string } | { all_projects: true };
export type ViewInput = Record<string, JsonValue>;
const entry = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
export async function createReadViewsHarness() {
  const fixture = await createOrdinaryFixture();
  createProject(
    fixture.human,
    'control',
    ordinaryInput(
      fixture,
      { slug: 'control', name: 'Контроль', emoji: '🪴' },
      { projectSlug: 'control' },
    ),
  );
  let app: ReturnType<typeof createApp> | undefined;
  try {
    const port = await availablePort();
    const host = `127.0.0.1:${port}`;
    app = createApp({ helper: createLazyDataHelper({ databasePath: fixture.path }), host });
    await app.listen({ host: '127.0.0.1', port });
    const opened = app;
    async function request(
      transport: 'cli' | 'http',
      view: string,
      scope: ViewScope = { all_projects: true },
      input: ViewInput = {},
    ) {
      if (transport === 'cli') {
        const result = spawnSync(
          process.execPath,
          [
            entry,
            view,
            ...('project_slug' in scope ? ['--project', scope.project_slug] : ['--all-projects']),
            '--json',
            '--input',
            '-',
          ],
          {
            env: { ...process.env, AI_TASKS_DB_PATH: fixture.path },
            encoding: 'utf8',
            input: JSON.stringify(input),
            timeout: 5000,
          },
        );
        if (result.error) throw result.error;
        if (result.signal !== null) throw new Error(`CLI terminated with ${result.signal}`);
        const output = result.status === 0 ? result.stdout : result.stderr;
        return {
          status: result.status,
          envelope: responseEnvelopeSchema.parse(JSON.parse(output)),
          stdout: result.stdout,
          stderr: result.stderr,
        };
      }
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries({ ...scope, ...input }))
        query.set(
          key,
          typeof value === 'string' && key !== 'priority' ? value : JSON.stringify(value),
        );
      const reply = await opened.inject({
        method: 'GET',
        url: `/api/v1/${view}?${query}`,
        headers: { host },
      });
      return {
        status: reply.statusCode,
        envelope: responseEnvelopeSchema.parse(reply.json()),
        stdout: '',
        stderr: '',
      };
    }
    return {
      fixture,
      app: opened,
      origin: `http://${host}`,
      request,
      seed: (options: ReadViewSeedOptions = {}) => seedReadViews(fixture, options),
      snapshot: () => readViewsSnapshot(fixture),
      async close() {
        try {
          await opened.close();
        } finally {
          await fixture.close();
        }
      },
    };
  } catch (error) {
    try {
      await app?.close();
    } finally {
      await fixture.close();
    }
    throw error;
  }
}
export type ReadViewsHarness = Awaited<ReturnType<typeof createReadViewsHarness>>;
