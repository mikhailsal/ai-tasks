import { toJSONSchema } from 'zod/v4/core';
import type * as z from 'zod/mini';
import { hint, type Hint } from '../../core/diagnostics/hints.js';
import { slugSchema, timestampSchema, uuidSchema } from '../../schema/values.js';

/** One input field of a command (spec 005 data-model, InputField). */
export type InputField = {
  name: string;
  type: string;
  required: boolean;
  nullable?: true;
  allowed?: (string | number | boolean)[];
  source?: Hint;
  repeats?: true;
  min?: number;
  max?: number;
  alternatives?: { when?: string; fields: InputField[] }[];
};
type Json = { [key: string]: unknown };

/** Fields whose allowed values come from the project configuration (spec 004 R2 map). */
const configurationFields: Record<string, Hint> = {
  status_id: hint('read_allowed_values', 'Read the configured statuses with config get', {
    command: 'config get',
  }),
  to_status_id: hint('read_allowed_values', 'Read the configured statuses with config get', {
    command: 'config get',
  }),
  level_id: hint('read_allowed_values', 'Read the named priority levels with config get', {
    command: 'config get',
  }),
};

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isJson) : [];
}
function literal(value: unknown): value is string | number | boolean {
  return ['string', 'number', 'boolean'].includes(typeof value);
}

function toJson(schema: z.ZodMiniType): Json {
  const named = new Map<unknown, string>([
    [timestampSchema, 'timestamp'],
    [uuidSchema, 'uuid'],
    [slugSchema, 'slug'],
  ]);
  const json: unknown = toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
    override(context) {
      const type = named.get(context.zodSchema);
      if (type) Object.assign(context.jsonSchema, { 'x-type': type });
    },
  });
  return isJson(json) ? json : {};
}

/** Splits `X | null` into `X` with a nullable mark. */
function unwrapNullable(schema: Json): { schema: Json; nullable: boolean } {
  const branches = list(schema.anyOf ?? schema.oneOf);
  const kept = branches.filter((branch) => branch.type !== 'null');
  if (branches.length > 0 && kept.length === branches.length - 1 && kept.length === 1)
    return { schema: kept[0] ?? schema, nullable: true };
  return { schema, nullable: false };
}

function scalarType(schema: Json): string {
  if (typeof schema['x-type'] === 'string') return schema['x-type'];
  if (schema.format === 'uuid') return 'uuid';
  return typeof schema.type === 'string' ? schema.type : 'value';
}

function allowedValues(schema: Json): (string | number | boolean)[] | undefined {
  if (literal(schema.const)) return [schema.const];
  if (Array.isArray(schema.enum)) return schema.enum.filter(literal);
  return undefined;
}

/** A property every branch fixes with `const` is the discriminator. */
function discriminator(branches: Json[]): string | undefined {
  const [first] = branches;
  if (!first || !isJson(first.properties)) return undefined;
  return Object.keys(first.properties).find((key) =>
    branches.every(
      (branch) =>
        isJson(branch.properties) &&
        isJson(branch.properties[key]) &&
        literal(branch.properties[key].const),
    ),
  );
}

function unionField(name: string, required: boolean, branches: Json[]): InputField {
  const key = discriminator(branches);
  const prefix = name === '' ? '' : `${name}.`;
  const alternatives = branches.map((branch) => {
    const value = key && isJson(branch.properties) ? branch.properties[key] : undefined;
    const when = isJson(value) && literal(value.const) ? String(value.const) : undefined;
    const fields = objectFields(branch, prefix).filter(
      (field) => field.name !== `${prefix}${key ?? ''}`,
    );
    return when === undefined ? { fields } : { when, fields };
  });
  const allowed = alternatives.flatMap((entry) => (entry.when === undefined ? [] : [entry.when]));
  return {
    name: key ? `${prefix}${key}` : name,
    type: key ? 'string' : 'object',
    required,
    ...(allowed.length > 0 ? { allowed } : {}),
    alternatives,
  };
}

/** A union of value lists (`a | b` enums) is one value field; other unions keep branches. */
function unionOf(name: string, required: boolean, branches: Json[]): InputField {
  const values = branches.map(allowedValues);
  if (values.every((entry) => entry !== undefined)) {
    const allowed = [...new Set(values.flat())];
    return { name, type: scalarType(branches[0] ?? {}), required, allowed };
  }
  return unionField(name, required, branches);
}

function arrayFields(name: string, required: boolean, schema: Json): InputField[] {
  const bounds = {
    ...(typeof schema.minItems === 'number' ? { min: schema.minItems } : {}),
    ...(typeof schema.maxItems === 'number' ? { max: schema.maxItems } : {}),
  };
  const items = isJson(schema.items) ? schema.items : {};
  const inner = isJson(items.properties)
    ? objectFields(items, `${name}[].`)
    : fieldsOf(`${name}[]`, true, items);
  return inner.map((field) => ({
    ...field,
    required: required && field.required,
    repeats: true,
    ...bounds,
  }));
}

function fieldsOf(name: string, required: boolean, raw: Json): InputField[] {
  const { schema, nullable } = unwrapNullable(raw);
  const mark = nullable ? { nullable: true as const } : {};
  const branches = list(schema.oneOf ?? schema.anyOf);
  if (branches.length > 0) return [{ ...unionOf(name, required, branches), ...mark }];
  if (schema.type === 'array') return arrayFields(name, required, schema);
  if (isJson(schema.properties))
    return objectFields(schema, `${name}.`).map((field) => ({
      ...field,
      required: required && field.required,
    }));
  const allowed = allowedValues(schema);
  const leaf = name.split('.').at(-1)?.replace('[]', '') ?? name;
  const source = configurationFields[leaf];
  return [
    {
      name,
      type: scalarType(schema),
      required,
      ...mark,
      ...(allowed ? { allowed } : {}),
      ...(source ? { source } : {}),
    },
  ];
}

function objectFields(schema: Json, prefix: string): InputField[] {
  const properties = isJson(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(properties).flatMap(([key, value]) =>
    isJson(value) ? fieldsOf(`${prefix}${key}`, required.has(key), value) : [],
  );
}

/** Input fields of a command, sorted by name (spec 005 R2). */
export function flattenSchema(schema: z.ZodMiniType, omit: readonly string[] = []): InputField[] {
  const json = toJson(schema);
  const branches = list(json.oneOf ?? json.anyOf);
  const fields = branches.length > 0 ? [unionField('', true, branches)] : objectFields(json, '');
  return fields
    .filter((field) => !omit.includes(field.name))
    .sort((left, right) => left.name.localeCompare(right.name));
}
