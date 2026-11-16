import type { Command } from 'commander';
import { describeRevisions } from '../../src/cli/registry/describe.js';
import { flattenSchema } from '../../src/cli/registry/flatten-schema.js';
import type { CommandDescriptor } from '../../src/cli/registry/types.js';
import { resolveExample, send, type ExampleRequest } from './help-runner.js';

/** Disagreement checks between help and behavior (spec 005 R6). Each returns problems. */
export function leafPaths(program: Command): string[] {
  const walk = (command: Command, words: string[]): string[] =>
    command.commands.length === 0
      ? [words.join(' ')]
      : command.commands.flatMap((child) => walk(child, [...words, child.name()]));
  return walk(program, []);
}

export function coverageProblems(
  program: Command,
  registry: readonly CommandDescriptor[],
): string[] {
  const leaves = new Set(leafPaths(program));
  const described = new Set(registry.map((entry) => entry.path.join(' ')));
  return [
    ...[...leaves].filter((path) => !described.has(path)).map((path) => `no descriptor: ${path}`),
    ...[...described].filter((path) => !leaves.has(path)).map((path) => `no command: ${path}`),
  ];
}

const tokenKeys =
  /^(operation_id|database_epoch|expected_revision|expected_config_revision|expected_settings_revision)$/u;

function without(request: ExampleRequest, key: string): ExampleRequest {
  const input = { ...request.input };
  delete input[key];
  return { ...request, input };
}

function refusalMentions(response: ReturnType<typeof send>, field: string): boolean {
  return !response.body.ok && JSON.stringify(response.body.error).includes(field);
}

function revisionProblems(
  descriptor: CommandDescriptor,
  env: NodeJS.ProcessEnv,
  request: ExampleRequest,
) {
  const problems: string[] = [];
  for (const revision of describeRevisions(descriptor)) {
    if (!revision.required || request.input?.[revision.field] === undefined) continue;
    const response = send(env, without(request, revision.field));
    const missing: unknown = Reflect.get(Object(response.body.error?.details), 'missing');
    const entry = Array.isArray(missing)
      ? missing.find((item: unknown) => Reflect.get(Object(item), 'field') === revision.field)
      : undefined;
    if (response.body.ok || entry === undefined)
      problems.push(
        `${descriptor.path.join(' ')}: dropping ${revision.field} was not refused as missing`,
      );
    else if (
      JSON.stringify(Reflect.get(Object(entry), 'source')) !== JSON.stringify(revision.source)
    )
      problems.push(
        `${descriptor.path.join(' ')}: refusal and help name different sources for ${revision.field}`,
      );
  }
  return problems;
}

async function fieldProblems(
  descriptor: CommandDescriptor,
  env: NodeJS.ProcessEnv,
  request: ExampleRequest,
) {
  if (!descriptor.input || !request.input) return [];
  const problems: string[] = [];
  const top = (await flattenSchema(await descriptor.input()))
    .filter((field) => field.required && !/[.[]/u.test(field.name))
    .map((field) => field.name);
  for (const field of top) {
    if (request.input[field] === undefined) continue;
    if (!refusalMentions(send(env, without(request, field)), field))
      problems.push(`${descriptor.path.join(' ')}: dropping required ${field} was not refused`);
  }
  const unknown = send(env, { ...request, input: { ...request.input, zz_unknown_field: 1 } });
  if (unknown.body.ok) problems.push(`${descriptor.path.join(' ')}: an unknown field was accepted`);
  return problems;
}

/** Runs refusal probes first (they change nothing), then the example built only from listed values. */
export async function exampleProblems(
  descriptor: CommandDescriptor,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  const resolved = resolveExample(descriptor, env);
  const listed = new Set(describeRevisions(descriptor).map((entry) => entry.field));
  const input = resolved.input
    ? Object.fromEntries(
        Object.entries(resolved.input).filter(([key]) => !tokenKeys.test(key) || listed.has(key)),
      )
    : undefined;
  const request = input ? { ...resolved, input } : resolved;
  const problems = [
    ...(descriptor.kind === 'mutation' ? revisionProblems(descriptor, env, request) : []),
    ...(descriptor.kind === 'mutation' ? await fieldProblems(descriptor, env, request) : []),
  ];
  const result = send(env, request);
  if (!result.body.ok)
    problems.push(
      `${descriptor.path.join(' ')}: example failed: ${JSON.stringify(result.body.error).slice(0, 400)}`,
    );
  return problems;
}
