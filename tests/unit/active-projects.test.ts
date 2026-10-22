import { afterEach, beforeEach, expect, it } from 'vitest';
import { activeProjectScopes } from '../../src/api/active-projects.js';
import { dispatch } from '../../src/api/dispatch.js';
import { updateProject } from '../../src/core/projects/commands.js';
import { normalizeEmoji } from '../../src/core/tasks/emoji.js';
import { successEnvelopeSchema } from '../../src/schema/envelopes.js';
import { generationFixture } from '../fixtures/recurrence-generations.js';
import { outcomeSnapshot } from '../fixtures/occurrence-outcomes.js';
import { ordinaryInput, type OrdinaryFixture } from '../fixtures/ordinary-work.js';
import { configRow, insertStorageRow, projectRow } from '../fixtures/storage-seed.js';

let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await generationFixture();
});
afterEach(() => fixture.close());
function manyProjects() {
  const keys = new Set<string>(['🌀']);
  const markers: { emoji: string; key: string }[] = [];
  for (let code = 0x1f300; markers.length < 201 && code <= 0x1faff; code++) {
    try {
      const marker = normalizeEmoji(String.fromCodePoint(code));
      if (!keys.has(marker.key)) {
        markers.push(marker);
        keys.add(marker.key);
      }
    } catch {
      /* Unsupported components are not eligible fixture markers. */
    }
  }
  expect(markers).toHaveLength(201);
  fixture.connection.sqlite.transaction(() => {
    for (const [index, marker] of markers.entries()) {
      const slug = `project-${index}`;
      insertStorageRow(
        fixture.connection.sqlite,
        'projects',
        projectRow({
          slug,
          emoji: marker.emoji,
          emoji_key: marker.key,
          archived_at: index === 200 ? fixture.clock.now() : null,
        }),
      );
      insertStorageRow(
        fixture.connection.sqlite,
        'project_configs',
        configRow({ project_slug: slug }),
      );
    }
  })();
}

it('API scope discovery validates and traverses actual project pages without domain writes', async () => {
  manyProjects();
  const before = outcomeSnapshot(fixture);
  let requests = 0;
  const scopes = await activeProjectScopes(async (command) => {
    requests++;
    return successEnvelopeSchema.parse(dispatch(fixture.human, command));
  });
  expect(requests).toBe(2);
  expect(scopes).toHaveLength(201);
  expect(new Set(scopes).size).toBe(201);
  expect(scopes).toContain('alpha');
  expect(scopes).toContain('project-199');
  expect(scopes).not.toContain('project-200');
  expect(outcomeSnapshot(fixture)).toEqual(before);
});

it('three real cursor invalidations defer discovery with no partial project set', async () => {
  manyProjects();
  let writes = 0;
  let requests = 0;
  const scopes = await activeProjectScopes(async (command) => {
    requests++;
    const result = successEnvelopeSchema.parse(dispatch(fixture.human, command));
    if (command.operation === 'project.list' && command.input.cursor === undefined) {
      writes++;
      updateProject(
        fixture.human,
        'alpha',
        ordinaryInput(fixture, { description: `Concurrent edit ${writes}` }, { revision: writes }),
      );
    }
    return result;
  });
  expect(scopes).toBeUndefined();
  expect(writes).toBe(3);
  expect(requests).toBe(6);
});
