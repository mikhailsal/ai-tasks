import type { Command, CommanderError } from 'commander';
import { domainError, type DomainError } from '../core/errors.js';
import { hint } from '../core/diagnostics/hints.js';
import { isSafeOptionName } from '../core/diagnostics/safe-names.js';
import { suggestNames } from './suggest.js';

function quoted(message: string): string | undefined {
  return /'([^']*)'/u.exec(message)?.[1];
}

function optionFlags(command: Command): string[] {
  const flags = new Set<string>();
  for (let current: Command | null = command; current; current = current.parent) {
    for (const option of current.options) if (option.long) flags.add(option.long);
  }
  return [...flags].sort();
}

function deepest(program: Command, argv: readonly string[]): { command: Command; depth: number } {
  let current = program;
  let depth = 0;
  for (const token of argv) {
    const next = token.startsWith('-')
      ? undefined
      : current.commands.find((child) => child.name() === token);
    if (!next) break;
    current = next;
    depth += 1;
  }
  return { command: current, depth };
}

export function unknownName(
  kind: 'command' | 'option',
  name: string | undefined,
  known: string[],
): DomainError {
  const safe = isSafeOptionName(name) ? name : undefined;
  const suggestions = safe ? suggestNames(safe, known) : [];
  const subject = safe ? `Unknown ${kind} ${safe}` : `Unknown ${kind}`;
  const tail = suggestions.length > 0 ? `. Did you mean ${suggestions.join(' or ')}?` : '';
  return domainError('VALIDATION_ERROR', `${subject}${tail}`, {
    names: safe ? [safe] : [],
    names_omitted: safe ? 0 : 1,
    suggestions,
  });
}

const helpHint = hint('use_supported_option', 'Run help for this command to see its arguments', {
  command: 'help',
});

/** Commander errors become specific refusals (spec 004 FR-008, FR-010, FR-011). */
export function commanderFailure(
  error: CommanderError,
  program: Command,
  argv: readonly string[],
): DomainError {
  const { command, depth } = deepest(program, argv);
  const name = quoted(error.message);
  const nextToken = argv[depth];
  const commandToken = nextToken !== undefined && !nextToken.startsWith('-') ? nextToken : name;
  switch (error.code) {
    case 'commander.unknownCommand':
      return unknownName(
        'command',
        commandToken,
        command.commands.map((child) => child.name()).sort(),
      );
    case 'commander.unknownOption':
      return unknownName('option', name, optionFlags(command));
    case 'commander.excessArguments':
      if (command.commands.length > 0)
        return unknownName(
          'command',
          commandToken,
          command.commands.map((child) => child.name()).sort(),
        );
      return domainError('VALIDATION_ERROR', 'Too many arguments for this command', {
        hints: [helpHint],
      });
    case 'commander.missingArgument':
      return domainError('VALIDATION_ERROR', 'A required argument is missing', {
        hints: [helpHint],
      });
    case 'commander.conflictingOption':
      return domainError(
        'VALIDATION_ERROR',
        'Choose either --project or --all-projects, not both',
        {
          hints: [hint('choose_scope', 'Use --project SLUG or --all-projects')],
        },
      );
    case 'commander.optionMissingArgument': {
      const flag = name?.split(' ')[0];
      const label = isSafeOptionName(flag) ? `Option ${flag}` : 'An option';
      return domainError('VALIDATION_ERROR', `${label} needs a value`, { hints: [helpHint] });
    }
    default:
      return domainError('VALIDATION_ERROR', 'Invalid command arguments');
  }
}
