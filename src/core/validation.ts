import type { z } from 'zod/mini';
import { normalizeError } from './errors.js';
/** Transport and direct engine calls share the same safe validation failures. */
export function parseInput<Schema extends z.ZodMiniType>(schema: Schema, input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw normalizeError(parsed.error);
  return parsed.data;
}
