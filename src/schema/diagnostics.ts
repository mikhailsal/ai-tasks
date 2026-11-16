import * as z from 'zod/mini';

/** Shapes inside `error.details` added by spec 004 (data-model.md). All are additive. */
export const hintActions = [
  'choose_scope',
  'read_revision',
  'read_allowed_values',
  'pause_parent',
  'cancel_future',
  'complete_occurrence',
  'close_as_missed',
  'run_tick',
  'run_migration',
  'use_supported_option',
] as const;

/** Blocker reasons in the order the steps must be taken. */
export const blockerReasons = [
  'owed_anchors',
  'parent_not_paused',
  'future_pending',
  'past_pending',
  'owed',
  'not_pending',
  'already_completed',
  'cancelled',
  'reason_exists',
  'reason_required',
] as const;

export const hintSchema = z.strictObject({
  action: z.enum(hintActions),
  text: z.string().check(z.maxLength(200)),
  command: z.optional(z.string()),
  field: z.optional(z.string()),
});

export const missingValueSchema = z.strictObject({ field: z.string(), source: hintSchema });

export const blockerSchema = z.strictObject({
  reason: z.enum(blockerReasons),
  count: z.int().check(z.minimum(0)),
  occurrence_ids: z.array(z.uuid()).check(z.maxLength(10)),
  omitted: z.int().check(z.minimum(0)),
  step: hintSchema,
});

export const issueDetailSchema = z.looseObject({
  code: z.string(),
  path: z.array(z.union([z.string(), z.number()])),
  expected: z.optional(z.string()),
  allowed: z.optional(z.array(z.string()).check(z.maxLength(20))),
  allowed_omitted: z.optional(z.int()),
  keys: z.optional(z.array(z.string()).check(z.maxLength(10))),
  keys_omitted: z.optional(z.int()),
});
