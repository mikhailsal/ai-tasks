import { z } from 'zod/mini';
export const BODY_LIMIT_BYTES = 1048576;
function validJsonArrayShape(value: object): boolean {
  const length: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) return false;
  const keys = Object.getOwnPropertyNames(value);
  if (keys.length !== length + 1) return false;
  return keys.every(
    (key) => key === 'length' || (/^(?:0|[1-9]\d*)$/u.test(key) && Number(key) < length),
  );
}
function validJsonFields(value: object, ancestors: Set<object>): boolean {
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  const array = Array.isArray(value);
  if (array && !validJsonArrayShape(value)) return false;
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!key.isWellFormed()) return false;
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return false;
    if (!validJsonStructure(descriptor.value, ancestors)) return false;
  }
  return true;
}
function validJsonStructure(value: unknown, ancestors: Set<object>): boolean {
  if (typeof value === 'string') return value.isWellFormed();
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return false;
  ancestors.add(value);
  try {
    return validJsonFields(value, ancestors);
  } finally {
    ancestors.delete(value);
  }
}
function safeJsonStructure(value: unknown): boolean {
  try {
    return validJsonStructure(value, new Set());
  } catch {
    return false;
  }
}
export type JsonValue = z.infer<ReturnType<typeof z.json>>;
// Native z.json()/z.record() may omit own __proto__ keys. Validate descriptors without
// reconstructing objects so every JSON key survives domain validation and fingerprints.
export const jsonValueSchema = z.custom<JsonValue>(safeJsonStructure, {
  message: 'JSON must contain supported own data values',
});
function codePointText(maximum: number, minimum = 0) {
  return z.string().check(
    z.refine((value) => {
      if (!value.isWellFormed()) return false;
      const length = Array.from(value).length;
      return length >= minimum && length <= maximum;
    }, `Must contain ${minimum}–${maximum} Unicode code points`),
  );
}
export const slugSchema = z
  .string()
  .check(z.maxLength(64))
  .check(z.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/));
export const titleSchema = z.pipe(z.string().check(z.trim()), codePointText(300, 1));
export const descriptionSchema = codePointText(100000);
export const nameSchema = z.pipe(z.string().check(z.trim()), codePointText(80, 1));
export const labelSchema = nameSchema;
export const uuidSchema = z.uuid();
export const revisionSchema = z.int().check(z.positive());
export const configKeySchema = z.string().check(z.regex(/^[A-Za-z0-9_-]+$/));
// Offset and calendar validity come from Zod; the extra pattern limits precision.
export const timestampSchema = z.pipe(
  z.pipe(
    z.string(),
    z.transform((value) => value.replace('t', 'T').replace(/z$/, 'Z')),
  ),
  z.iso
    .datetime({ offset: true })
    .check(z.regex(/T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/)),
);
export const timezoneSchema = z.string().check(
  z.refine((timezone) => {
    if (/^[+-]/.test(timezone)) return false;
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }, 'Must be a valid IANA timezone'),
);
/** Transport callers apply this to the complete JSON body, except backup transfer. */
export const jsonBodySchema = jsonValueSchema.check(
  z.refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= BODY_LIMIT_BYTES,
    'JSON body must be at most 1 MiB',
  ),
);
export function validateJsonBodySize(value: JsonValue): JsonValue {
  return jsonBodySchema.parse(value);
}
