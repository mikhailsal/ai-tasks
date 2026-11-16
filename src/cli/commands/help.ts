import type { Command } from 'commander';
import { domainError } from '../../core/errors.js';
import { writeJson } from '../io.js';
import { commandOptions, requireOptions } from '../options.js';
import { unknownName } from '../parse-errors.js';
import { describeCommand } from '../registry/describe.js';
import { scopeFlags } from '../registry/scope-flags.js';
import {
  commandIndex,
  descriptorFor,
  familyMembers,
  findDescriptor,
  registry,
} from '../registry/index.js';

function commanderTarget(program: Command, words: readonly string[]): Command {
  let current = program;
  for (const word of words) {
    const next = current.commands.find((child) => child.name() === word);
    if (!next) return current;
    current = next;
  }
  return current;
}

/** Names known at the depth where the request stops matching. */
function knownNames(words: readonly string[]): { name: string | undefined; known: string[] } {
  const depth = words.findIndex(
    (_, index) =>
      !registry.some((entry) =>
        words.slice(0, index + 1).every((word, at) => entry.path[at] === word),
      ),
  );
  const prefix = words.slice(0, depth);
  const known = registry
    .filter((entry) => prefix.every((word, at) => entry.path[at] === word))
    .flatMap((entry) => (entry.path[depth] === undefined ? [] : [entry.path[depth]]));
  return { name: words[depth], known: [...new Set(known)].sort() };
}

async function jsonHelp(program: Command, words: readonly string[]) {
  if (words.length === 0) return { help: program.helpInformation(), commands: commandIndex() };
  const leaf = findDescriptor(words);
  if (leaf) return describeCommand(leaf);
  const [family] = words;
  const members = words.length === 1 && family !== undefined ? familyMembers(family) : [];
  if (members.length > 0)
    return {
      command: family,
      members: members.map((entry) => ({
        command: entry.path.join(' '),
        purpose: entry.purpose,
        scope: entry.scope,
        scope_flags: scopeFlags[entry.scope],
      })),
    };
  const { name, known } = knownNames(words);
  throw unknownName('command', name, known);
}

/** `help [command...]`: informational, no database access (spec 005 contracts/help.md). */
export function registerHelpCommand(program: Command): void {
  program
    .command('help')
    .description('Show command help')
    .allowExcessArguments(true)
    .action(async (_options: unknown, command: Command) => {
      const options = commandOptions(command);
      requireOptions(options, descriptorFor(command).options);
      const words = command.args;
      if (options.json) {
        writeJson({ ok: true, data: await jsonHelp(program, words) });
        return;
      }
      if (words.length > 0 && !findDescriptor(words) && familyMembers(words[0] ?? '').length === 0)
        throw domainError('VALIDATION_ERROR', 'Unknown command; run help --json for the index');
      process.stdout.write(commanderTarget(program, words).helpInformation());
    });
}
