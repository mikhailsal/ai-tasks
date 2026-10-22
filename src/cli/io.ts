import { createReadStream } from 'node:fs';
import * as z from 'zod/mini';
import { domainError, errorEnvelope, cliExit, DomainError } from '../core/errors.js';
import { mutationEnvelopeSchema } from '../schema/envelopes.js';
import { BODY_LIMIT_BYTES, jsonValueSchema, type JsonValue } from '../schema/values.js';
import { positiveIntegerOption, readScope, type CliOptions } from './options.js';
export type CliInput = z.infer<z.ZodMiniRecord<z.ZodMiniString, typeof jsonValueSchema>>;
const inputObjectSchema = z.custom<CliInput>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    jsonValueSchema.safeParse(value).success,
);
async function readBytes(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.byteLength;
    if (size > BODY_LIMIT_BYTES) throw domainError('VALIDATION_ERROR', 'JSON input exceeds 1 MiB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}
export async function readJsonInput(
  source: string | undefined,
  stdin: AsyncIterable<Uint8Array> = process.stdin,
): Promise<CliInput> {
  if (source === undefined) return {};
  if (source === '-' && stdin === process.stdin && process.stdin.isTTY) {
    throw domainError('VALIDATION_ERROR', 'JSON stdin requires a pipe or redirected input');
  }
  try {
    const bytes = await readBytes(source === '-' ? stdin : createReadStream(source));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.trim().length === 0) throw domainError('VALIDATION_ERROR', 'JSON input is empty');
    return inputObjectSchema.parse(JSON.parse(text));
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw domainError(
      'VALIDATION_ERROR',
      'Input must be a readable UTF-8 JSON object within 1 MiB',
    );
  }
}
export function scopedInput(options: CliOptions, body: CliInput): CliInput {
  const normalized = { ...body };
  if (Object.hasOwn(body, 'project_slug')) {
    if (options.project === undefined || body.project_slug !== options.project) {
      throw domainError(
        'VALIDATION_ERROR',
        'Input project scope must match the explicit project option',
      );
    }
    delete normalized.project_slug;
  }
  return normalized;
}
const preconditionOptions = [
  ['operation_id', 'operationId', false],
  ['database_epoch', 'databaseEpoch', false],
  ['expected_revision', 'expectedRevision', true],
  ['expected_config_revision', 'expectedConfigRevision', true],
  ['expected_settings_revision', 'expectedSettingsRevision', true],
] as const;
/** Keep file JSON and flag strings intact until their transport schemas validate them. */
export function mutationInput(options: CliOptions, body: CliInput) {
  const scope = readScope(options);
  if (!('project_slug' in scope))
    throw domainError('VALIDATION_ERROR', 'Mutations require an explicit project');
  const payload = scopedInput(options, body);
  const preconditions: Record<string, JsonValue> = {};
  for (const [field, option, numeric] of preconditionOptions) {
    const flag = options[option];
    if (flag !== undefined && Object.hasOwn(payload, field)) {
      throw domainError('VALIDATION_ERROR', 'Mutation field cannot appear in both flags and JSON');
    }
    if (flag !== undefined) preconditions[field] = numeric ? positiveIntegerOption(flag) : flag;
    else if (Object.hasOwn(payload, field))
      preconditions[field] = jsonValueSchema.parse(payload[field]);
    delete payload[field];
  }
  return {
    projectSlug: scope.project_slug,
    input: mutationEnvelopeSchema.parse({ ...preconditions, payload }),
  };
}
export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
export function writeFailure(error: unknown): void {
  process.stderr.write(`${JSON.stringify(errorEnvelope(error))}\n`);
  process.exitCode = cliExit(error);
}
