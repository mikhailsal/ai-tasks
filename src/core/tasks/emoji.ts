import { and, eq, ne } from 'drizzle-orm';
import emojiRegex from 'emoji-regex';
import {
  projects,
  projectEmojiReservations,
  taskEmojiReservations,
  tasks,
} from '../../schema/entities.js';
import { slugSchema, uuidSchema } from '../../schema/values.js';
import type { DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { readClock } from '../time.js';

export const DEFAULT_TASK_EMOJI = '⚪';
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
// emoji-regex is pinned to 11.0.0 in the lockfile. Anchor its deterministic sequence
// recognizer instead of accepting a matching substring inside arbitrary text.
const pinnedPattern = emojiRegex();
const recognizer = new RegExp(
  `^(?:${pinnedPattern.source})$`,
  pinnedPattern.flags.replace('g', ''),
);

export function normalizeEmoji(value: unknown) {
  if (typeof value !== 'string') {
    throw domainError('VALIDATION_ERROR', 'Emoji must contain exactly one RGI emoji grapheme');
  }
  const emoji = value.normalize('NFC');
  const graphemes = segmenter.segment(emoji)[Symbol.iterator]();
  const empty = graphemes.next().done;
  const multiple = !graphemes.next().done;
  // The pinned recognizer also matches standalone components; those are not complete
  // RGI emoji. Presentation selectors are recognized without changing displayed text.
  const candidate = emoji.replace(/\uFE0E/gu, '\uFE0F');
  if (empty || multiple || /^\p{Emoji_Component}$/u.test(emoji) || !recognizer.test(candidate)) {
    throw domainError('VALIDATION_ERROR', 'Emoji must contain exactly one RGI emoji grapheme');
  }
  return { emoji, key: emoji.replace(/[\uFE0E\uFE0F]/gu, '') };
}

function validateScope(projectSlug: string): void {
  if (!slugSchema.safeParse(projectSlug).success) {
    throw domainError('VALIDATION_ERROR', 'An explicit valid project slug is required');
  }
}

function projectOwner(transaction: DatabaseTransaction, key: string): string | undefined {
  const permanent = transaction
    .select({ owner: projectEmojiReservations.projectSlug })
    .from(projectEmojiReservations)
    .where(eq(projectEmojiReservations.emojiKey, key))
    .get();
  if (permanent) return permanent.owner;
  return transaction
    .select({ owner: projects.slug })
    .from(projects)
    .where(eq(projects.emojiKey, key))
    .get()?.owner;
}

function conflict(projectSlug: string, key: string): never {
  throw domainError('EMOJI_CONFLICT', 'Emoji is already reserved', {
    project_slug: projectSlug,
    emoji_key: key,
  });
}

/** The caller holds the write transaction; this helper never changes project display. */
export function reserveProjectEmoji(
  transaction: DatabaseTransaction,
  options: {
    projectSlug: string;
    emoji: string;
    now: number;
  },
) {
  validateScope(options.projectSlug);
  const normalized = normalizeEmoji(options.emoji);
  const now = readClock(() => options.now);
  if (normalized.key === DEFAULT_TASK_EMOJI) {
    throw domainError('VALIDATION_ERROR', 'Projects require a nondefault emoji');
  }
  const existing = transaction
    .select()
    .from(projectEmojiReservations)
    .where(eq(projectEmojiReservations.emojiKey, normalized.key))
    .get();
  if (existing && existing.projectSlug !== options.projectSlug)
    conflict(options.projectSlug, normalized.key);
  const otherProject = transaction
    .select({ slug: projects.slug })
    .from(projects)
    .where(and(eq(projects.emojiKey, normalized.key), ne(projects.slug, options.projectSlug)))
    .get();
  const storedTask = transaction
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.emojiKey, normalized.key))
    .get();
  if (otherProject || storedTask) conflict(options.projectSlug, normalized.key);
  if (!existing) {
    transaction
      .insert(projectEmojiReservations)
      .values({
        emojiKey: normalized.key,
        projectSlug: options.projectSlug,
        emoji: normalized.emoji,
        firstReservedAt: now,
      })
      .run();
  }
  return normalized;
}

function verifyTaskOwner(
  transaction: DatabaseTransaction,
  projectSlug: string,
  taskId: string,
): void {
  if (!uuidSchema.safeParse(taskId).success) {
    throw domainError('VALIDATION_ERROR', 'A valid task ID is required');
  }
  const task = transaction
    .select({ projectSlug: tasks.projectSlug })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  if (!task) throw domainError('TASK_NOT_FOUND', 'The requested task does not exist');
  if (task.projectSlug !== projectSlug) {
    throw domainError('PROJECT_MISMATCH', 'The target belongs to another project');
  }
}

function taskMarkerOccupied(
  transaction: DatabaseTransaction,
  options: {
    projectSlug: string;
    taskId: string;
    key: string;
    reserve: boolean;
  },
): boolean {
  if (projectOwner(transaction, options.key) !== undefined) return true;
  if (!options.reserve) return false;
  const namespace = transaction
    .select({ taskId: taskEmojiReservations.taskId })
    .from(taskEmojiReservations)
    .where(
      and(
        eq(taskEmojiReservations.projectSlug, options.projectSlug),
        eq(taskEmojiReservations.emojiKey, options.key),
      ),
    )
    .get();
  return namespace !== undefined && namespace.taskId !== options.taskId;
}

/** Lifecycle decisions belong to commands. Only reopening/restoration commands may
 * request use_default; ordinary create/edit callers use the default rejection policy.
 * This helper changes reservations and returns display values for the caller to store. */
export function syncTaskEmoji(
  transaction: DatabaseTransaction,
  options: {
    projectSlug: string;
    taskId: string;
    emoji: string;
    reserve: boolean;
    collision?: 'reject' | 'use_default';
  },
) {
  validateScope(options.projectSlug);
  verifyTaskOwner(transaction, options.projectSlug, options.taskId);
  let normalized = normalizeEmoji(options.emoji);
  if (
    normalized.key !== DEFAULT_TASK_EMOJI &&
    taskMarkerOccupied(transaction, {
      projectSlug: options.projectSlug,
      taskId: options.taskId,
      key: normalized.key,
      reserve: options.reserve,
    })
  ) {
    if (options.collision !== 'use_default') conflict(options.projectSlug, normalized.key);
    normalized = { emoji: DEFAULT_TASK_EMOJI, key: DEFAULT_TASK_EMOJI };
  }
  const existing = transaction
    .select()
    .from(taskEmojiReservations)
    .where(eq(taskEmojiReservations.taskId, options.taskId))
    .get();
  const mustReserve = options.reserve && normalized.key !== DEFAULT_TASK_EMOJI;
  if (
    mustReserve &&
    existing?.projectSlug === options.projectSlug &&
    existing.emojiKey === normalized.key
  )
    return normalized;
  transaction
    .delete(taskEmojiReservations)
    .where(eq(taskEmojiReservations.taskId, options.taskId))
    .run();
  if (mustReserve) {
    transaction
      .insert(taskEmojiReservations)
      .values({
        projectSlug: options.projectSlug,
        taskId: options.taskId,
        emojiKey: normalized.key,
      })
      .run();
  }
  return normalized;
}
