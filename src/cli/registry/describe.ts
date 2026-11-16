import type { Hint } from '../../core/diagnostics/hints.js';
import { mutationRequirements } from '../../core/database/mutation-requirements.js';
import { requiredRevisions, revisionSource } from '../../core/database/required-revisions.js';
import { flattenSchema, type InputField } from './flatten-schema.js';
import { scopeFlags } from './scope-flags.js';
import type { CommandDescriptor, CommandExample } from './types.js';

export type RevisionValue = { field: string; required: boolean; condition?: string; source: Hint };

const scopeFields = ['project_slug', 'all_projects'];

const tokenOptions = new Set(['json', 'project', 'allProjects', 'input']);

export function flagName(key: string): string {
  return `--${key.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** Revision values with their sources, from the same table the guards use (spec 005 R3). */
export function describeRevisions(descriptor: CommandDescriptor): RevisionValue[] {
  if (!descriptor.mutation) return [];
  const requirements = mutationRequirements[descriptor.mutation];
  const fields = requiredRevisions(requirements, { recurring: true });
  return fields.map((field, index) => {
    const conditional =
      field === 'expected_settings_revision' &&
      'settings' in requirements &&
      requirements.settings === 'recurring' &&
      index === fields.length - 1;
    return {
      field,
      required: !conditional,
      ...(conditional ? { condition: 'required for recurring tasks' } : {}),
      source: revisionSource(field, requirements),
    };
  });
}

function inputForms(descriptor: CommandDescriptor) {
  const forms: string[] = [];
  if (descriptor.options.includes('input')) forms.push('--input FILE', '--input -');
  if (descriptor.options.some((key) => !tokenOptions.has(key))) forms.push('options');
  return { forms, equivalent: true };
}

function exampleOutput(example: CommandExample) {
  return {
    argv: example.argv,
    ...(example.input ? { input: example.input } : {}),
    placeholders: example.placeholders,
    fixture_note: example.fixture_note,
  };
}

async function fields(descriptor: CommandDescriptor): Promise<InputField[]> {
  if (!descriptor.input) return [];
  return flattenSchema(await descriptor.input(), scopeFields);
}

/** One leaf command's description (spec 005 contracts/help.md). */
export async function describeCommand(descriptor: CommandDescriptor) {
  const inputFields = await fields(descriptor);
  return {
    command: descriptor.path.join(' '),
    purpose: descriptor.purpose,
    kind: descriptor.kind,
    scope: descriptor.scope,
    scope_flags: scopeFlags[descriptor.scope],
    positional: descriptor.positional ?? [],
    options: descriptor.options.map(flagName).sort(),
    input_forms: inputForms(descriptor),
    fields: inputFields,
    ...(inputFields.length === 0 ? { no_input: true } : {}),
    revisions: describeRevisions(descriptor),
    example: exampleOutput(descriptor.example),
  };
}
