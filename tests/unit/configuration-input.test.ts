import { expect, it } from 'vitest';
import {
  paletteSchema,
  priorityModelSchema,
  priorityValueSchema,
  ordinaryWorkflowSchema,
  recurringWorkflowSchema,
  projectConfigInputSchema,
  toScaledPriority,
  validatePriorityForModel,
} from '../../src/schema/configuration.js';
import {
  createDefaultProjectConfig,
  createDefaultOrdinaryWorkflow,
  createDefaultRecurringWorkflow,
  getBuiltinPresets,
} from '../../src/core/projects/presets.js';

it.each([
  [0, 0],
  [-0, 0],
  [1.001, 1001],
  [-1.001, -1001],
  [0.001, 1],
  [-0.001, -1],
  [1.01, 1010],
  [123.456, 123456],
  [999999999.999, 999999999999],
  [1000000000, 1000000000000],
  [-1000000000, -1000000000000],
])(
  'represents %s as exactly %s thousandths without binary-float rejection or rounding',
  (value, scaled) => {
    expect(toScaledPriority(value)).toBe(scaled);
    expect(priorityValueSchema.parse({ model: 'numeric', value })).toEqual({
      model: 'numeric',
      value,
    });
  },
);

it.each([
  0.0001,
  1e-7,
  1.0001,
  -1.0001,
  0.1 + 0.2,
  1000000000.001,
  -1000000000.001,
  NaN,
  Infinity,
  -Infinity,
])('rejects excessive precision, range, or nonfinite numeric priority %s', (value) => {
  expect(() => toScaledPriority(value)).toThrow();
  expect(priorityValueSchema.safeParse({ model: 'numeric', value }).success).toBe(false);
});

it.each([
  { type: 'numeric', min: 1, max: 1, direction: 'higher' },
  { type: 'numeric', min: 2, max: 1, direction: 'higher' },
  { type: 'numeric', min: 0, max: 1, direction: 'up' },
  { type: 'numeric', min: 0.0001, max: 1, direction: 'higher' },
  { type: 'numeric', min: -1000000001, max: 1, direction: 'lower' },
  { type: 'classic', levels: [] },
  { type: 'named', levels: [] },
])('rejects invalid priority configuration %j', (model) => {
  expect(priorityModelSchema.safeParse(model).success).toBe(false);
});

it('accepts inclusive model bounds and null while rejecting incompatible or unknown priorities', () => {
  const numeric = priorityModelSchema.parse({
    type: 'numeric',
    min: -1.001,
    max: 1.001,
    direction: 'lower',
  });
  for (const value of [-1.001, 0, 1.001])
    expect(validatePriorityForModel({ model: 'numeric', value }, numeric)).toEqual({
      model: 'numeric',
      value,
    });
  expect(() => validatePriorityForModel({ model: 'numeric', value: 1.002 }, numeric)).toThrow();
  const named = priorityModelSchema.parse({
    type: 'named',
    levels: [{ id: '__proto__', label: 'Первый' }],
  });
  expect(validatePriorityForModel({ model: 'named', level_id: '__proto__' }, named)).toEqual({
    model: 'named',
    level_id: '__proto__',
  });
  expect(() => validatePriorityForModel({ model: 'named', level_id: 'missing' }, named)).toThrow();
  for (const model of getBuiltinPresets().priority_models) {
    expect(validatePriorityForModel(null, model)).toBeNull();
    const wrong =
      model.type === 'classic'
        ? { model: 'numeric', value: 1 }
        : { model: 'classic', level: 'high' };
    expect(() => validatePriorityForModel(wrong, model)).toThrow();
  }
});

it.each([
  { model: 'classic', level: 'urgent' },
  { model: 'eisenhower', important: 1, urgent: false },
  { model: 'eisenhower', important: true },
  { model: 'named', levelId: 'high' },
  { model: 'numeric', value: '1.001' },
  { model: 'classic', level: 'high', extra: true },
])('rejects coercion, unknown values and unknown priority fields %j', (value) => {
  expect(priorityValueSchema.safeParse(value).success).toBe(false);
});

it('enforces the fixed palette and distinct stable level IDs with a 100-level maximum', () => {
  expect(paletteSchema.options).toEqual([
    'slate',
    'red',
    'orange',
    'amber',
    'green',
    'teal',
    'blue',
    'indigo',
    'violet',
    'rose',
  ]);
  for (const value of ['purple', '#ffffff', 'Red', 'blue;script'])
    expect(paletteSchema.safeParse(value).success).toBe(false);
  const levels = Array.from({ length: 100 }, (_, index) => ({
    id: `level_${index}`,
    label: `Уровень ${index}`,
  }));
  expect(priorityModelSchema.safeParse({ type: 'named', levels }).success).toBe(true);
  expect(
    priorityModelSchema.safeParse({
      type: 'named',
      levels: [...levels, { id: 'extra', label: 'Лишний' }],
    }).success,
  ).toBe(false);
  expect(
    priorityModelSchema.safeParse({ type: 'named', levels: [...levels.slice(0, 99), levels[0]] })
      .success,
  ).toBe(false);
  for (const id of ['', 'кириллица', 'bad key', 'bad.key']) {
    expect(
      priorityModelSchema.safeParse({ type: 'named', levels: [{ id, label: 'Имя' }] }).success,
    ).toBe(false);
  }
});

it('allows minimal workflows while enforcing configured initial and restore category membership', () => {
  expect(
    ordinaryWorkflowSchema.parse({
      initial_status_id: 'only',
      statuses: [{ id: 'only', label: 'Ожидание', category: 'not_started' }],
      transitions: [],
    }).statuses,
  ).toHaveLength(1);
  const recurring = {
    initial_status_id: 'draft',
    restore_status_id: 'paused',
    statuses: [
      { id: 'draft', label: 'Черновик', category: 'draft' },
      { id: 'paused', label: 'Пауза', category: 'paused' },
    ],
    transitions: [],
  };
  expect(recurringWorkflowSchema.parse(recurring).statuses).toHaveLength(2);
  expect(
    recurringWorkflowSchema.safeParse({ ...recurring, restore_status_id: 'draft' }).success,
  ).toBe(false);
  expect(
    recurringWorkflowSchema.safeParse({ ...recurring, initial_status_id: 'paused' }).success,
  ).toBe(false);
  const missingRestore: Partial<typeof recurring> = { ...recurring };
  delete missingRestore.restore_status_id;
  expect(recurringWorkflowSchema.safeParse(missingRestore).success).toBe(false);
  const ordinary = createDefaultOrdinaryWorkflow();
  expect(ordinaryWorkflowSchema.safeParse({ ...ordinary, initial_status_id: 'done' }).success).toBe(
    false,
  );
  expect(
    ordinaryWorkflowSchema.safeParse({ ...ordinary, initial_status_id: 'absent' }).success,
  ).toBe(false);
});

it('validates status uniqueness and the 100-status limit independently for each workflow', () => {
  const ordinary = createDefaultOrdinaryWorkflow();
  const statuses = Array.from({ length: 100 }, (_, index) => ({
    id: `s${index}`,
    label: `Статус ${index}`,
    category: 'not_started',
  }));
  const workflow = { initial_status_id: 's0', statuses, transitions: [] };
  expect(ordinaryWorkflowSchema.safeParse(workflow).success).toBe(true);
  expect(
    ordinaryWorkflowSchema.safeParse({
      ...workflow,
      statuses: [...statuses, { id: 'extra', label: 'Лишний', category: 'not_started' }],
    }).success,
  ).toBe(false);
  expect(
    ordinaryWorkflowSchema.safeParse({
      ...ordinary,
      statuses: [...ordinary.statuses, ordinary.statuses[0]],
    }).success,
  ).toBe(false);
  const recurring = createDefaultRecurringWorkflow();
  expect(
    recurringWorkflowSchema.safeParse({
      ...recurring,
      statuses: [...recurring.statuses, recurring.statuses[0]],
    }).success,
  ).toBe(false);
});

it.each([
  { from: 'idea', to: 'missing', requires_confirmation: false },
  { from: 'missing', to: 'idea', requires_confirmation: false },
  { from: 'idea', to: 'planning' },
  { from: 'idea', to: 'planning', requires_confirmation: 'false' },
  { from: 'idea', to: 'planning', requires_confirmation: false, guard: 'custom code' },
])('rejects invalid or incomplete transition declarations %j', (edge) => {
  const workflow = createDefaultOrdinaryWorkflow();
  expect(ordinaryWorkflowSchema.safeParse({ ...workflow, transitions: [edge] }).success).toBe(
    false,
  );
});

it('rejects duplicate edges, allows explicit self-edges, and enforces strict nested objects', () => {
  const workflow = createDefaultOrdinaryWorkflow();
  const edge = { from: 'idea', to: 'planning', requires_confirmation: false };
  expect(
    ordinaryWorkflowSchema.safeParse({
      ...workflow,
      transitions: [edge, { ...edge, requires_confirmation: true }],
    }).success,
  ).toBe(false);
  expect(
    ordinaryWorkflowSchema.safeParse({
      ...workflow,
      transitions: [{ from: 'idea', to: 'idea', requires_confirmation: false }],
    }).success,
  ).toBe(true);
  expect(
    ordinaryWorkflowSchema.safeParse({
      ...workflow,
      statuses: [{ id: 'idea', label: 'Идея', category: 'not_started', extra: true }],
    }).success,
  ).toBe(false);
  const config = createDefaultProjectConfig();
  expect(projectConfigInputSchema.safeParse({ ...config, unexpected: true }).success).toBe(false);
  expect(
    projectConfigInputSchema.safeParse({
      ...config,
      priority_model: { type: 'classic', weight: 5 },
    }).success,
  ).toBe(false);
});

it('provides every specified ordinary edge with only sanity_check → done requiring consent', () => {
  const workflow = createDefaultOrdinaryWorkflow();
  expect(workflow.initial_status_id).toBe('idea');
  const actual = workflow.transitions.map((edge) => `${edge.from}->${edge.to}`).sort();
  expect(actual).toEqual(
    [
      'idea->planning',
      'planning->ready',
      'ready->in_progress',
      'in_progress->sanity_check',
      'sanity_check->done',
      'planning->idea',
      'ready->planning',
      'in_progress->ready',
      'sanity_check->in_progress',
      'done->sanity_check',
      'done->in_progress',
      'idea->cancelled',
      'planning->cancelled',
      'ready->cancelled',
      'in_progress->cancelled',
      'sanity_check->cancelled',
      'cancelled->idea',
    ].sort(),
  );
  expect(workflow.transitions.filter((edge) => edge.requires_confirmation)).toEqual([
    { from: 'sanity_check', to: 'done', requires_confirmation: true },
  ]);
});

it('provides all recurring preset edges with a paused restore status and fresh four-model templates', () => {
  const recurring = createDefaultRecurringWorkflow();
  expect(recurring.initial_status_id).toBe('draft');
  expect(recurring.restore_status_id).toBe('paused');
  expect(recurring.transitions.map((edge) => `${edge.from}->${edge.to}`).sort()).toEqual(
    [
      'draft->active',
      'draft->archived',
      'active->paused',
      'active->archived',
      'paused->active',
      'paused->archived',
      'archived->paused',
    ].sort(),
  );
  expect(recurring.transitions.every((edge) => edge.requires_confirmation === false)).toBe(true);
  const presets = getBuiltinPresets();
  expect(presets.priority_models.map((model) => model.type)).toEqual([
    'classic',
    'eisenhower',
    'named',
    'numeric',
  ]);
  for (const model of presets.priority_models)
    expect(projectConfigInputSchema.safeParse(createDefaultProjectConfig(model)).success).toBe(
      true,
    );
  const first = createDefaultProjectConfig();
  if (first.ordinary_workflow.statuses[0]) first.ordinary_workflow.statuses[0].label = 'Изменено';
  expect(createDefaultProjectConfig().ordinary_workflow.statuses[0]?.label).toBe('Идея');
  expect(projectConfigInputSchema.parse(createDefaultProjectConfig()).priority_model).toEqual({
    type: 'classic',
  });
});
