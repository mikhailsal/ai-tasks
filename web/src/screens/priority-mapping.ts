import type { PriorityModel, PriorityValue } from '../../../src/schema/configuration.js';
export const NULL_PRIORITY_OPTION = ':unset';
export type PriorityMappingChoice = { selected: boolean; to: PriorityValue };
type SelectModel = Extract<PriorityModel, { type: 'named' | 'classic' }>;
export function encodePriorityMapping(mapping: PriorityMappingChoice): string {
  if (!mapping.selected) return '';
  if (mapping.to === null) return NULL_PRIORITY_OPTION;
  if (mapping.to.model === 'named') return mapping.to.level_id;
  if (mapping.to.model === 'classic') return mapping.to.level;
  return '';
}
export function decodePriorityMapping(
  selection: string,
  model: SelectModel,
): PriorityMappingChoice {
  if (!selection) return { selected: false, to: null };
  if (selection === NULL_PRIORITY_OPTION) return { selected: true, to: null };
  if (model.type === 'named' && model.levels.some((level) => level.id === selection))
    return { selected: true, to: { model: 'named', level_id: selection } };
  if (
    model.type === 'classic' &&
    (selection === 'critical' ||
      selection === 'high' ||
      selection === 'normal' ||
      selection === 'low')
  )
    return { selected: true, to: { model: 'classic', level: selection } };
  throw new Error('Выберите доступный уровень приоритета.');
}
