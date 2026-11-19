import { expect, it } from 'vitest';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import { jsonValueSchema } from '../../src/schema/values.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditAction, auditValue } from '../../web/src/screens/audit-display.js';

it('qualifies captured status meanings when ordinary and recurring workflows share one stable ID', () => {
  const config = createDefaultProjectConfig();
  config.ordinary_workflow = {
    initial_status_id: 'shared',
    statuses: [{ id: 'shared', label: 'Входящие', category: 'not_started' }],
    transitions: [],
  };
  config.recurring_workflow = {
    initial_status_id: 'shared',
    restore_status_id: 'paused',
    statuses: [
      { id: 'shared', label: 'Черновик цикла', category: 'draft' },
      { id: 'paused', label: 'Приостановлено', category: 'paused' },
    ],
    transitions: [],
  };
  const snapshot = jsonValueSchema.parse({ revision: 1, ...config });
  const text = auditValue('status_id', 'shared', snapshot);
  expect(text).toContain('Обычные задачи: Входящие (shared)');
  expect(text).toContain('Повторяющиеся задачи: Черновик цикла (shared)');
});

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [readFileSync(join(dir, entry.name), 'utf8')]
        : [],
  );
}

it('names every audited action in Russian, never as a raw key (QA F9)', () => {
  const recorded = new Set(
    // Every adapter and core module, from the repository root, whatever the working directory.
    sources(fileURLToPath(new URL('../../src', import.meta.url))).flatMap((text) =>
      [...text.matchAll(/action: '([a-z_]+\.[a-z_]+)'/gu)].map((match) => match[1] ?? ''),
    ),
  );
  expect(recorded.size).toBeGreaterThan(10);
  for (const action of recorded) expect(auditAction(action)).not.toBe(action);
});

it('shows a board position as its stage and position, not JSON', () => {
  const config = createDefaultProjectConfig();
  const snapshot = jsonValueSchema.parse({ revision: 1, ...config });
  const status = config.recurring_workflow.statuses[0];
  const text = auditValue(
    'board_position',
    jsonValueSchema.parse({ status_id: status?.id, position: 1 }),
    snapshot,
  );
  expect(text).toBe(`Стадия «${status?.label ?? ''}», позиция 1`);
  expect(
    auditValue('board_position', jsonValueSchema.parse({ status_id: 'gone', position: 3 }), null),
  ).toBe('Стадия «gone», позиция 3');
});

it('names both stages when the two workflows share a status id', () => {
  const config = createDefaultProjectConfig();
  config.ordinary_workflow = {
    initial_status_id: 'shared',
    statuses: [{ id: 'shared', label: 'Входящие', category: 'not_started' }],
    transitions: [],
  };
  config.recurring_workflow = {
    initial_status_id: 'shared',
    restore_status_id: 'paused',
    statuses: [
      { id: 'shared', label: 'Черновик цикла', category: 'draft' },
      { id: 'paused', label: 'Приостановлено', category: 'paused' },
    ],
    transitions: [],
  };
  const snapshot = jsonValueSchema.parse({ revision: 1, ...config });
  expect(
    auditValue(
      'board_position',
      jsonValueSchema.parse({ status_id: 'shared', position: 2 }),
      snapshot,
    ),
  ).toBe('Стадия «Входящие / Черновик цикла», позиция 2');
});
