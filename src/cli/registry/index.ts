import type { Command } from 'commander';
import { domainError } from '../../core/errors.js';
import { auditCommands } from './families/audit.js';
import { backupCommands } from './families/backup.js';
import { configCommands } from './families/config.js';
import { coreCommands } from './families/core.js';
import { dependencyCommands } from './families/dependency.js';
import { descriptionCommands } from './families/description.js';
import { occurrenceCommands } from './families/occurrence.js';
import { projectCommands } from './families/project.js';
import { recurrenceCommands } from './families/recurrence.js';
import { settingsCommands } from './families/settings.js';
import { taskCommands } from './families/task.js';
import { viewsCommands } from './families/views.js';
import type { CommandDescriptor } from './types.js';

/** Every leaf command, sorted by path (spec 005 R1). */
export const registry: readonly CommandDescriptor[] = [
  ...coreCommands,
  ...projectCommands,
  ...taskCommands,
  ...configCommands,
  ...descriptionCommands,
  ...dependencyCommands,
  ...auditCommands,
  ...recurrenceCommands,
  ...occurrenceCommands,
  ...settingsCommands,
  ...viewsCommands,
  ...backupCommands,
].sort((left, right) => left.path.join(' ').localeCompare(right.path.join(' ')));

export function findDescriptor(path: readonly string[]): CommandDescriptor | undefined {
  const key = path.join(' ');
  return registry.find((descriptor) => descriptor.path.join(' ') === key);
}

export function familyMembers(word: string): CommandDescriptor[] {
  return registry.filter((descriptor) => descriptor.path.length > 1 && descriptor.path[0] === word);
}

/** Command words of a Commander leaf, without the program name. */
export function commandPath(command: Command): string[] {
  const words: string[] = [];
  for (let current: Command | null = command; current?.parent; current = current.parent)
    words.unshift(current.name());
  return words;
}

/** The descriptor of a running action; a leaf without one is a build defect. */
export function descriptorFor(command: Command): CommandDescriptor {
  const descriptor = findDescriptor(commandPath(command));
  if (!descriptor) throw domainError('INTERNAL_ERROR', 'Command has no registry descriptor');
  return descriptor;
}

/** Whole-interface index grouped by the first path word. */
export function commandIndex() {
  const groups = new Map<string, { command: string; purpose: string; scope: string }[]>();
  for (const descriptor of registry) {
    const family = descriptor.path[0] ?? '';
    groups.set(family, [
      ...(groups.get(family) ?? []),
      { command: descriptor.path.join(' '), purpose: descriptor.purpose, scope: descriptor.scope },
    ]);
  }
  return [...groups].map(([family, commands]) => ({ family, commands }));
}
