import { randomUUID } from 'node:crypto';
import { findDescriptor } from '../../src/cli/registry/index.js';
import type { CommandDescriptor, Placeholder } from '../../src/cli/registry/types.js';
import { cliRunner, type Cli, type Envelope } from './help-fixtures.js';

/** Reads `a.b[0].c` or `items[kind=recurring].id` from a response. */
export function resolvePath(value: unknown, path: string): unknown {
  const steps = path.match(/[^.[\]]+|\[[^\]]*\]/gu) ?? [];
  let current: unknown = value;
  for (const step of steps) {
    if (current === undefined || current === null) return undefined;
    const filter = /^\[([^=\]]+)=([^\]]*)\]$/u.exec(step);
    const index = /^\[(\d+)\]$/u.exec(step);
    if (filter && Array.isArray(current))
      current = current.find(
        (item: unknown) => String(Reflect.get(Object(item), filter[1] ?? '')) === filter[2],
      );
    else if (index && Array.isArray(current)) current = current[Number(index[1])];
    else current = Reflect.get(Object(current), step);
  }
  return current;
}

const scopeArgs: Record<CommandDescriptor['scope'], string[]> = {
  project: ['--project', 'demo'],
  either: ['--project', 'demo'],
  all_projects: ['--all-projects'],
  none: [],
};

export type ExampleRequest = { argv: string[]; input?: Record<string, unknown> };

/** Resolves placeholders only by running the named source commands (spec 005 R5). */
export class PlaceholderResolver {
  private readonly values = new Map<string, unknown>();
  constructor(
    private readonly run: Cli,
    private readonly declared: Record<string, Placeholder>,
  ) {}

  value(name: string): unknown {
    if (this.values.has(name)) return this.values.get(name);
    const placeholder = this.declared[name];
    if (!placeholder) throw new Error(`undeclared placeholder ${name}`);
    const resolved =
      'generate' in placeholder
        ? randomUUID()
        : 'example' in placeholder
          ? this.fromExample(placeholder)
          : this.read(placeholder);
    if (resolved === undefined) throw new Error(`placeholder ${name} resolved to nothing`);
    this.values.set(name, resolved);
    return resolved;
  }

  private fromExample(placeholder: { example: string; path: string }): unknown {
    const source = findDescriptor(placeholder.example.split(' '));
    if (!source) throw new Error(`placeholder example ${placeholder.example} is not a command`);
    const nested = new PlaceholderResolver(this.run, source.example.placeholders);
    const argv = source.example.argv.map((part) => String(nested.substitute(part)));
    const input =
      source.example.input === undefined ? undefined : nested.substitute(source.example.input);
    return resolvePath(this.run(argv, input).body, placeholder.path);
  }

  private read(placeholder: { command: string; path: string }): unknown {
    const parts = placeholder.command.split(' ');
    const flagAt = parts.findIndex((part) => part.startsWith('--'));
    const words = flagAt < 0 ? parts : parts.slice(0, flagAt);
    const flags = flagAt < 0 ? [] : parts.slice(flagAt);
    const source = findDescriptor(words);
    if (!source) throw new Error(`placeholder source ${placeholder.command} is not a command`);
    const positional = (source.positional ?? []).map((entry) =>
      String(this.value(entry.name.replaceAll('-', '_'))),
    );
    const response = this.run([
      ...words,
      ...positional,
      ...flags,
      ...scopeArgs[source.scope],
      '--json',
    ]);
    return resolvePath(response.body, placeholder.path);
  }

  substitute(value: unknown): unknown {
    if (typeof value === 'string') {
      const whole = /^\{\{(\w+)\}\}$/u.exec(value);
      if (whole) return this.value(whole[1] ?? '');
      return value.replaceAll(/\{\{(\w+)\}\}/gu, (_, name: string) => String(this.value(name)));
    }
    if (Array.isArray(value)) return value.map((item) => this.substitute(item));
    if (typeof value === 'object' && value !== null)
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.substitute(item)]),
      );
    return value;
  }
}

/** The example with every placeholder resolved. */
export function resolveExample(
  descriptor: CommandDescriptor,
  env: NodeJS.ProcessEnv,
): ExampleRequest {
  const resolver = new PlaceholderResolver(cliRunner(env), descriptor.example.placeholders);
  const argv = descriptor.example.argv.map((part) => String(resolver.substitute(part)));
  const input = descriptor.example.input;
  return input === undefined
    ? { argv }
    : { argv, input: resolver.substitute(input) as Record<string, unknown> };
}

export function send(
  env: NodeJS.ProcessEnv,
  request: ExampleRequest,
): { status: number | null; body: Envelope } {
  return cliRunner(env)(request.argv, request.input);
}
