import {
  toScaledPriority,
  validatePriorityForModel,
  type PriorityModel,
  type PriorityValue,
} from '../../schema/configuration.js';
import { jsonValueSchema } from '../../schema/values.js';
import { domainError, normalizeError } from '../errors.js';

export function validatePriority(value: unknown, model: PriorityModel): PriorityValue {
  try {
    return validatePriorityForModel(value, model);
  } catch (error) {
    throw normalizeError(error);
  }
}

/** SQLite numeric rank uses integer thousandths; the JSON value stays unrounded. */
export function priorityColumns(value: unknown, model: PriorityModel) {
  const priority = validatePriority(value, model);
  return {
    priority: jsonValueSchema.parse(priority),
    priorityScaled: priority?.model === 'numeric' ? toScaledPriority(priority.value) : null,
  };
}

/** Lower ranks sort first within one project's model. Unset is a separate final group. */
export function priorityRank(value: unknown, model: PriorityModel): number | null {
  const priority = validatePriority(value, model);
  if (priority === null) return null;
  if (priority.model === 'classic') {
    return ['critical', 'high', 'normal', 'low'].indexOf(priority.level);
  }
  if (priority.model === 'eisenhower') {
    return (priority.important ? 0 : 2) + (priority.urgent ? 0 : 1);
  }
  if (priority.model === 'numeric' && model.type === 'numeric') {
    const rank = toScaledPriority(priority.value);
    if (rank === 0) return 0;
    return model.direction === 'higher' ? -rank : rank;
  }
  if (priority.model === 'named' && model.type === 'named') {
    return model.levels.findIndex((level) => level.id === priority.level_id);
  }
  throw domainError('INTERNAL_ERROR', 'Validated priority model is inconsistent');
}

export function comparePriorities(left: unknown, right: unknown, model: PriorityModel): number {
  const leftRank = priorityRank(left, model);
  const rightRank = priorityRank(right, model);
  if (leftRank === null) return rightRank === null ? 0 : 1;
  if (rightRank === null) return -1;
  return leftRank - rightRank;
}
