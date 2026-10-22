import { expect, it } from 'vitest';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import { jsonValueSchema } from '../../src/schema/values.js';
import { auditValue } from '../../web/src/screens/audit-display.js';

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
