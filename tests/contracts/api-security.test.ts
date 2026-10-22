import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/api/app.js';
import { startDataHelper } from '../../src/api/helper-client.js';
import { openDatabase } from '../../src/core/database/open.js';
import { migrateDatabase } from '../../src/core/database/migrate.js';
import { acquireDatabaseLock, releaseDatabaseLock } from '../../src/runtime/database-lock.js';
import { createDatabaseFixture, type DatabaseFixture } from '../fixtures/database.js';
import { createTestClock } from '../fixtures/clock.js';

let fixture: DatabaseFixture;
let app: ReturnType<typeof createApp>;
const host = '127.0.0.1:3000';
const origin = `http://${host}`;
const mutationHeaders = {
  host,
  origin,
  'content-type': 'application/json',
  'x-ai-tasks-mutation': '1',
};

beforeAll(async () => {
  fixture = await createDatabaseFixture(
    { openDatabase, migrateDatabase, acquireDatabaseLock, releaseDatabaseLock },
    createTestClock(),
  );
  try {
    const helper = await startDataHelper({ databasePath: fixture.path });
    app = createApp({ helper });
    // A pure POST route still passes the complete browser boundary before its handler.
    app.post('/api/v1/preview-test', async () =>
      helper.request({ operation: 'meta', scope: { all_projects: true } }),
    );
    await app.ready();
  } catch (error) {
    await fixture.close();
    throw error;
  }
});
afterAll(async () => {
  try {
    await app?.close();
  } finally {
    await fixture?.close();
  }
});

describe('real API helper and browser request security', () => {
  it('serves unauthenticated metadata with exact host, safe headers and no domain writes', async () => {
    const before = fixture.connection.sqlite.prepare('SELECT * FROM application_state').all();
    const response = await app.inject({ url: '/api/v1/meta?all_projects=true', headers: { host } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: { timezone: 'Europe/Moscow', settings_revision: 1, maintenance: false },
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("script-src 'self'");
    expect(response.headers['content-security-policy']).not.toContain('unsafe-inline');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(fixture.connection.sqlite.prepare('SELECT * FROM application_state').all()).toEqual(
      before,
    );
    expect(
      fixture.connection.sqlite.prepare('SELECT count(*) AS count FROM audit_records').get(),
    ).toEqual({ count: 0 });
  });

  it.each([
    { host: 'attacker.example:3000' },
    { host: '127.0.0.1' },
    { host, 'sec-fetch-site': 'cross-site' },
    { host, 'sec-fetch-site': 'invalid' },
  ])('rejects unsafe read host/fetch metadata %j', async (headers) => {
    const response = await app.inject({ url: '/api/v1/meta?all_projects=true', headers });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ ok: false, error: { code: 'ORIGIN_REJECTED' } });
  });

  it.each([
    '',
    '?all_projects=false',
    '?all_projects=true&all_projects=false',
    '?all_projects=true&actor=human-web',
  ])('rejects missing/ambiguous/extra read scope %s', async (query) => {
    const response = await app.inject({ url: `/api/v1/meta${query}`, headers: { host } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it.each([
    { ...mutationHeaders, origin: '' },
    { ...mutationHeaders, origin: 'http://attacker.example' },
    { ...mutationHeaders, origin: 'http://127.0.0.1:5173' },
    { ...mutationHeaders, 'content-type': 'text/plain' },
    { ...mutationHeaders, 'x-ai-tasks-mutation': '' },
    { ...mutationHeaders, 'sec-fetch-site': 'cross-site' },
  ])('rejects incomplete/cross-origin pure POST boundary %j', async (headers) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/preview-test',
      headers,
      payload: '{}',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ ok: false, error: { code: 'ORIGIN_REJECTED' } });
  });

  it('allows a complete same-origin pure POST and rejects malformed/oversized JSON safely', async () => {
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/preview-test',
      headers: mutationHeaders,
      payload: '{}',
    });
    expect(accepted.statusCode).toBe(200);
    for (const payload of ['{broken', JSON.stringify({ text: 'x'.repeat(1_048_576) })]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/preview-test',
        headers: mutationHeaders,
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
      expect(response.body).not.toContain(fixture.path);
    }
  });

  it('returns structured API 404 instead of application HTML', async () => {
    const response = await app.inject({ url: '/api/v1/unknown-route', headers: { host } });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ ok: false, error: { code: 'ROUTE_NOT_FOUND' } });
  });

  it('serves the production shell, deep navigation fallback and emitted JavaScript with safe headers', async () => {
    const shell = await app.inject({ url: '/', headers: { host } });
    expect(shell.statusCode).toBe(200);
    expect(shell.headers['content-type']).toContain('text/html');
    const deep = await app.inject({ url: '/projects/alpha/tasks', headers: { host } });
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toBe(shell.body);
    const asset = shell.body.match(/src="([^"]+\.js)"/u)?.[1];
    expect(asset).toBeDefined();
    if (asset === undefined) throw new Error('Production shell has no JavaScript entry');
    const script = await app.inject({ url: asset, headers: { host } });
    expect(script.statusCode).toBe(200);
    expect(script.headers['cache-control']).toBe('no-store');
    expect(script.headers['x-content-type-options']).toBe('nosniff');
  });
});
