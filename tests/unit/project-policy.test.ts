import { describe, expect, it } from 'vitest';
import {
  comparePriorities,
  priorityColumns,
  priorityRank,
  validatePriority,
} from '../../src/core/projects/priorities.js';
import {
  findWorkflowTransition,
  requireWorkflowStatus,
  validateOrdinaryWorkflow,
  validateRecurringWorkflow,
  workflowFor,
} from '../../src/core/projects/workflows.js';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import {
  priorityValueSchema,
  priorityModelSchema,
  type PriorityModel,
  type PriorityValue,
} from '../../src/schema/configuration.js';
import { jsonValueSchema, type JsonValue } from '../../src/schema/values.js';

const rankCases: { model: PriorityModel; ordered: PriorityValue[] }[] = [
  {
    model: { type: 'classic' },
    ordered: [
      { model: 'classic', level: 'critical' },
      { model: 'classic', level: 'high' },
      { model: 'classic', level: 'normal' },
      { model: 'classic', level: 'low' },
    ],
  },
  {
    model: { type: 'eisenhower' },
    ordered: [
      { model: 'eisenhower', important: true, urgent: true },
      { model: 'eisenhower', important: true, urgent: false },
      { model: 'eisenhower', important: false, urgent: true },
      { model: 'eisenhower', important: false, urgent: false },
    ],
  },
  {
    model: {
      type: 'named',
      levels: [
        { id: 'later', label: 'А' },
        { id: 'critical', label: 'Я' },
      ],
    },
    ordered: [
      { model: 'named', level_id: 'later' },
      { model: 'named', level_id: 'critical' },
    ],
  },
  {
    model: { type: 'numeric', min: -1_000_000_000, max: 1_000_000_000, direction: 'higher' },
    ordered: [
      { model: 'numeric', value: 1_000_000_000 },
      { model: 'numeric', value: 1.001 },
      { model: 'numeric', value: 0 },
      { model: 'numeric', value: -1_000_000_000 },
    ],
  },
  {
    model: { type: 'numeric', min: -2, max: 2, direction: 'lower' },
    ordered: [
      { model: 'numeric', value: -2 },
      { model: 'numeric', value: -0.001 },
      { model: 'numeric', value: 0 },
      { model: 'numeric', value: 1.001 },
    ],
  },
];

describe('shared project priority policy', () => {
  it.each(rankCases)(
    'uses the exact configured $model rank with unset last and stable ties',
    ({ model, ordered }) => {
      const scrambled = [null, ...ordered.toReversed(), null];
      expect(scrambled.sort((left, right) => comparePriorities(left, right, model))).toEqual([
        ...ordered,
        null,
        null,
      ]);
      expect(priorityRank(null, model)).toBeNull();
      expect(comparePriorities(null, null, model)).toBe(0);
      for (const value of ordered) {
        expect(comparePriorities(value, structuredClone(value), model)).toBe(0);
        expect(comparePriorities(value, null, model)).toBeLessThan(0);
        expect(comparePriorities(null, value, model)).toBeGreaterThan(0);
      }
    },
  );

  it('keeps numeric storage and ranks in exact integer thousandths without rounding source values', () => {
    const higher: PriorityModel = {
      type: 'numeric',
      min: -1_000_000_000,
      max: 1_000_000_000,
      direction: 'higher',
    };
    const numericCases: [number, number][] = [
      [-1_000_000_000, -1_000_000_000_000],
      [-1.001, -1001],
      [-0.001, -1],
      [0, 0],
      [0.001, 1],
      [1.001, 1001],
      [1_000_000_000, 1_000_000_000_000],
    ];
    for (const [value, scaled] of numericCases) {
      const priority = { model: 'numeric', value };
      const columns = priorityColumns(priority, higher);
      expect(columns.priority).toEqual(priority);
      expect(Number.isSafeInteger(columns.priorityScaled)).toBe(true);
      expect(columns.priorityScaled).toBe(scaled);
      expect(priorityRank(priority, higher)).toBe(scaled === 0 ? 0 : -scaled);
    }
    expect(priorityColumns({ model: 'numeric', value: 1.001 }, higher).priorityScaled).toBe(1001);
    expect(priorityColumns({ model: 'numeric', value: 0.001 }, higher).priorityScaled).toBe(1);
    expect(priorityColumns(null, higher)).toEqual({ priority: null, priorityScaled: null });
    expect(
      priorityColumns({ model: 'classic', level: 'high' }, { type: 'classic' }).priorityScaled,
    ).toBeNull();
  });

  it.each<JsonValue>([
    { model: 'numeric', value: 1.0001 },
    { model: 'numeric', value: 1_000_000_001 },
    { model: 'numeric', value: -1_000_000_001 },
    { model: 'numeric', value: 1.002 },
    { model: 'named', level_id: 'absent' },
    { model: 'eisenhower', important: true, urgent: false },
  ])(
    'rejects invalid or incompatible priority %j through the shared schema and safe core error',
    (value) => {
      const model = { type: 'numeric', min: -1.001, max: 1.001, direction: 'higher' } as const;
      expect(() => priorityColumns(value, model)).toThrowError(
        expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      );
      expect(() => priorityRank(value, model)).toThrowError(
        expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      );
    },
  );

  it('uses stable named IDs rather than labels, rejects unknown IDs, and never changes input', () => {
    const model = priorityModelSchema.parse({
      type: 'named',
      levels: [{ id: '__proto__', label: 'Обычный', color: 'rose' }],
    });
    const value = priorityValueSchema.parse({ model: 'named', level_id: '__proto__' });
    const before = structuredClone(value);
    expect(validatePriority(value, model)).toEqual(value);
    expect(priorityRank(value, model)).toBe(0);
    expect(value).toEqual(before);
    expect(() => validatePriority({ model: 'named', level_id: 'Обычный' }, model)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(() =>
      validatePriority(null, priorityModelSchema.parse({ type: 'classic' })),
    ).not.toThrow();
  });
});

describe('shared configured workflow policy', () => {
  it('selects categories and transitions by stable ID, including backward edges and exact consent flags', () => {
    const config = createDefaultProjectConfig();
    config.ordinary_workflow.statuses = config.ordinary_workflow.statuses.map((status) => ({
      ...status,
      label: 'Любая подпись',
    }));
    expect(workflowFor(config, 'ordinary')).toBe(config.ordinary_workflow);
    expect(workflowFor(config, 'recurring')).toBe(config.recurring_workflow);
    expect(requireWorkflowStatus(config, 'ordinary', 'done').category).toBe('completed');
    expect(requireWorkflowStatus(config, 'recurring', 'paused').category).toBe('paused');
    expect(findWorkflowTransition(config, 'ordinary', 'sanity_check', 'done')).toMatchObject({
      requires_confirmation: true,
    });
    expect(findWorkflowTransition(config, 'ordinary', 'done', 'sanity_check')).toMatchObject({
      requires_confirmation: false,
    });
    expect(findWorkflowTransition(config, 'ordinary', 'idea', 'done')).toBeUndefined();
    expect(() => requireWorkflowStatus(config, 'ordinary', 'missing')).toThrowError(
      expect.objectContaining({ code: 'INTERNAL_ERROR' }),
    );
  });

  it('shares initial/restore membership validation and does not infer edges from array order', () => {
    const config = createDefaultProjectConfig();
    const ordinary = {
      ...config.ordinary_workflow,
      transitions: [],
      statuses: config.ordinary_workflow.statuses.toReversed(),
    };
    expect(validateOrdinaryWorkflow(ordinary)).toEqual(ordinary);
    expect(validateRecurringWorkflow(config.recurring_workflow)).toEqual(config.recurring_workflow);
    expect(() => validateOrdinaryWorkflow({ ...ordinary, initial_status_id: 'done' })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(() =>
      validateRecurringWorkflow({ ...config.recurring_workflow, restore_status_id: 'active' }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(() =>
      validateOrdinaryWorkflow({ ...ordinary, transitions: [{ from: 'idea', to: 'done' }] }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(jsonValueSchema.parse(ordinary)).toEqual(ordinary);
  });
});
