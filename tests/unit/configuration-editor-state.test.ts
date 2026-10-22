import { describe, expect, it } from 'vitest';
import { getBuiltinPresets } from '../../src/core/projects/presets.js';
import {
  configurationDraft,
  configurationDraftSchema,
  configurationInput,
  renameStatus,
} from '../../web/src/components/configuration-model.js';
import {
  decodePriorityMapping,
  encodePriorityMapping,
  NULL_PRIORITY_OPTION,
} from '../../web/src/screens/priority-mapping.js';
import {
  mergeConfigurationPreview,
  missingRequiredMappings,
} from '../../web/src/screens/configuration-preview-state.js';
import {
  configurationFieldsSchema,
  type ConfigurationFields,
} from '../../web/src/screens/configuration-fields.js';
import type { ConfigurationPreview } from '../../web/src/screens/configuration-fields.js';
import { projectFieldsSchema } from '../../web/src/screens/project-fields.js';
function fields(): ConfigurationFields {
  const presets = getBuiltinPresets();
  return {
    config: configurationDraft({
      priority_model: { type: 'classic' },
      ordinary_workflow: presets.ordinary_workflow,
      recurring_workflow: presets.recurring_workflow,
    }),
    status_mappings: [],
    priority_mappings: [],
    affected_tasks: [],
  };
}
const noRequired: ConfigurationPreview = {
  required_status_mappings: [],
  required_priority_mappings: [],
  affected_tasks: [],
  issues: [],
};
describe('configuration editor explicit priority choices', () => {
  it.each(['unset', '__proto__', 'constructor'])(
    'round trips the legal named level %s independently from null',
    (id) => {
      const model = { type: 'named' as const, levels: [{ id, label: 'Именованный уровень' }] };
      const mapping = { selected: true, to: { model: 'named' as const, level_id: id } };
      const encoded = encodePriorityMapping(mapping);
      expect(encoded).toBe(id);
      expect(decodePriorityMapping(encoded, model)).toEqual(mapping);
      expect(encoded).not.toBe(encodePriorityMapping({ selected: true, to: null }));
    },
  );
  it('distinguishes no choice from explicit null', () => {
    const model = { type: 'named' as const, levels: [{ id: 'unset', label: 'Настоящий уровень' }] };
    expect(decodePriorityMapping(NULL_PRIORITY_OPTION, model)).toEqual({
      selected: true,
      to: null,
    });
    expect(decodePriorityMapping('', model)).toEqual({ selected: false, to: null });
    expect(NULL_PRIORITY_OPTION).not.toBe('unset');
  });
});
describe('configuration preview preserves explicit proposals', () => {
  it('keeps a valid optional status mapping when adding the old status back removes the requirement', () => {
    const proposed = fields();
    proposed.status_mappings = [
      { kind: 'ordinary', from_status_id: 'idea', to_status_id: 'queued' },
    ];
    expect(mergeConfigurationPreview(proposed, noRequired).status_mappings).toEqual(
      proposed.status_mappings,
    );
  });
  it('keeps a selected optional priority mapping when its source becomes valid again', () => {
    const proposed = fields();
    proposed.priority_mappings = [
      { from: { model: 'classic', level: 'high' }, to: null, selected: true },
    ];
    expect(mergeConfigurationPreview(proposed, noRequired).priority_mappings).toEqual(
      proposed.priority_mappings,
    );
  });
  it('keeps unknown explicit mappings for visible correction instead of deleting invalid proposals', () => {
    const proposed = fields();
    proposed.status_mappings = [
      { kind: 'ordinary', from_status_id: 'unknown', to_status_id: 'idea' },
    ];
    const preview = {
      ...noRequired,
      issues: [{ code: 'VALIDATION_ERROR' as const, message: 'Unknown mapping source' }],
    };
    expect(mergeConfigurationPreview(proposed, preview).status_mappings).toEqual(
      proposed.status_mappings,
    );
  });
  it('allows explicitly clearing optional mappings without deadlocking Apply', () => {
    const proposed = fields();
    proposed.status_mappings = [{ kind: 'ordinary', from_status_id: 'idea', to_status_id: '' }];
    proposed.priority_mappings = [
      { from: { model: 'classic', level: 'high' }, to: null, selected: false },
    ];
    expect(missingRequiredMappings(proposed, noRequired)).toBe(false);
    const merged = mergeConfigurationPreview(proposed, noRequired);
    expect(merged.status_mappings).toEqual([]);
    expect(merged.priority_mappings).toEqual([]);
  });
  it('adds missing mandatory placeholders and still requires their explicit choices', () => {
    const preview = {
      ...noRequired,
      required_status_mappings: [{ kind: 'ordinary' as const, from_status_id: 'idea' }],
      required_priority_mappings: [{ from: { model: 'classic' as const, level: 'high' as const } }],
    };
    const merged = mergeConfigurationPreview(fields(), preview);
    expect(merged.status_mappings).toEqual([
      { kind: 'ordinary', from_status_id: 'idea', to_status_id: '' },
    ]);
    expect(merged.priority_mappings).toEqual([
      { from: { model: 'classic', level: 'high' }, to: null, selected: false },
    ]);
    expect(missingRequiredMappings(merged, preview)).toBe(true);
  });
});
describe('permissive configuration draft persistence', () => {
  it('retains duplicate IDs and empty labels while strict submission refuses them in Russian', () => {
    const value = fields().config;
    const first = value.ordinary_workflow.statuses[0];
    const second = value.ordinary_workflow.statuses[1];
    if (!first || !second) throw new Error('Preset must have at least two statuses');
    first.label = '';
    second.id = first.id;
    expect(configurationDraftSchema.parse(value)).toEqual(value);
    expect(() => configurationInput(value)).toThrow(/Идентификаторы.*уникальными/);
  });
  it('renames references deliberately without corrupting them through duplicate-and-correct edits', () => {
    const value = fields().config.ordinary_workflow;
    const renamed = renameStatus(value, 0, 'queued');
    expect(renamed.initial_status_id).toBe('queued');
    expect(renamed.transitions.some((edge) => edge.from === 'queued')).toBe(true);
    const duplicate = renameStatus(value, 1, 'idea');
    const corrected = renameStatus(duplicate, 1, 'planning');
    expect(corrected).toEqual(value);
  });
  it('retains an invalid numeric mapping target across structural draft loading', () => {
    const draft = fields();
    draft.priority_mappings = [
      {
        from: { model: 'classic', level: 'high' },
        to: { model: 'numeric', value: 1.2345 },
        selected: true,
      },
    ];
    expect(configurationFieldsSchema.parse(draft).priority_mappings).toEqual(
      draft.priority_mappings,
    );
  });
  it('loads older project drafts with no custom configuration field', () => {
    expect(
      projectFieldsSchema.parse({
        slug: 'alpha',
        name: 'Проект',
        emoji: '🧪',
        description: '',
        priority: '0',
        preset: 'classic',
      }).config,
    ).toBeNull();
  });
});
