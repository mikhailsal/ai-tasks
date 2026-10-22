import type Database from 'better-sqlite3';
import * as z from 'zod/mini';
import type { ReservationConflict } from '../../schema/recovery.js';
import { domainError } from '../errors.js';

const reservationRowSchema = z.strictObject({
  emoji_key: z.string().check(z.minLength(1)),
  project_slug: z.string().check(z.minLength(1)),
  emoji: z.string(),
  first_reserved_at: z.int(),
});
const projectMarkerSchema = z.strictObject({
  slug: z.string().check(z.minLength(1)),
  emoji_key: z.string().check(z.minLength(1)),
});
const taskMarkerSchema = z.strictObject({
  id: z.string().check(z.minLength(1)),
  project_slug: z.string().check(z.minLength(1)),
  emoji_key: z.string().check(z.minLength(1)),
});
export type ProjectEmojiReservation = z.output<typeof reservationRowSchema>;

function compareScalars(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function compareNullable(left: string | null, right: string | null): number {
  if (left === null) return right === null ? 0 : -1;
  if (right === null) return 1;
  return compareScalars(left, right);
}

export function sortReservationConflicts(
  conflicts: readonly ReservationConflict[],
): ReservationConflict[] {
  const unique = new Map<string, ReservationConflict>();
  for (const conflict of conflicts) {
    unique.set(
      JSON.stringify([
        conflict.reason,
        conflict.emoji_key,
        conflict.reservation_project_slug,
        conflict.conflicting_project_slug,
        conflict.entity_id,
      ]),
      { ...conflict },
    );
  }
  return [...unique.values()].sort(
    (left, right) =>
      compareScalars(left.emoji_key, right.emoji_key) ||
      compareScalars(left.reason, right.reason) ||
      compareScalars(left.reservation_project_slug, right.reservation_project_slug) ||
      compareScalars(left.conflicting_project_slug, right.conflicting_project_slug) ||
      compareNullable(left.entity_id, right.entity_id),
  );
}

export function readProjectEmojiReservations(sqlite: Database.Database): ProjectEmojiReservation[] {
  const rows: unknown = sqlite
    .prepare(
      `SELECT emoji_key, project_slug, emoji, first_reserved_at
       FROM project_emoji_reservations ORDER BY emoji_key`,
    )
    .all();
  return z.array(reservationRowSchema).parse(rows);
}

export function mergeProjectEmojiReservations(
  live: readonly ProjectEmojiReservation[],
  snapshot: readonly ProjectEmojiReservation[],
): ProjectEmojiReservation[] {
  const merged = new Map<string, ProjectEmojiReservation>();
  for (const row of snapshot) merged.set(row.emoji_key, reservationRowSchema.parse(row));
  for (const row of live) merged.set(row.emoji_key, reservationRowSchema.parse(row));
  return [...merged.values()].sort((left, right) =>
    compareScalars(left.emoji_key, right.emoji_key),
  );
}

function markerConflicts(
  snapshotSqlite: Database.Database,
  reservations: ReadonlyMap<string, ProjectEmojiReservation>,
  mismatchedKeys: ReadonlySet<string>,
): ReservationConflict[] {
  const conflicts: ReservationConflict[] = [];
  const projects: unknown = snapshotSqlite
    .prepare('SELECT slug, emoji_key FROM projects ORDER BY slug')
    .all();
  for (const project of z.array(projectMarkerSchema).parse(projects)) {
    if (mismatchedKeys.has(project.emoji_key)) continue;
    const reservation = reservations.get(project.emoji_key);
    if (reservation && reservation.project_slug !== project.slug) {
      conflicts.push({
        reason: 'project_marker_collision',
        emoji_key: project.emoji_key,
        reservation_project_slug: reservation.project_slug,
        conflicting_project_slug: project.slug,
        entity_id: null,
      });
    }
  }
  const tasks: unknown = snapshotSqlite
    .prepare("SELECT id, project_slug, emoji_key FROM tasks WHERE emoji_key != '⚪' ORDER BY id")
    .all();
  for (const task of z.array(taskMarkerSchema).parse(tasks)) {
    if (mismatchedKeys.has(task.emoji_key)) continue;
    const reservation = reservations.get(task.emoji_key);
    if (reservation) {
      conflicts.push({
        reason: 'task_marker_collision',
        emoji_key: task.emoji_key,
        reservation_project_slug: reservation.project_slug,
        conflicting_project_slug: task.project_slug,
        entity_id: task.id,
      });
    }
  }
  return conflicts;
}

export function assertRecoveryReservations(
  liveSqlite: Database.Database,
  snapshotSqlite: Database.Database,
): void {
  const liveReservations = readProjectEmojiReservations(liveSqlite);
  const snapshotReservations = readProjectEmojiReservations(snapshotSqlite);
  const liveByKey = new Map(liveReservations.map((row) => [row.emoji_key, row]));
  const snapshotByKey = new Map(snapshotReservations.map((row) => [row.emoji_key, row]));
  const conflicts: ReservationConflict[] = [];
  const mismatchedKeys = new Set<string>();

  for (const [key, snapshot] of snapshotByKey) {
    const live = liveByKey.get(key);
    if (live && live.project_slug !== snapshot.project_slug) {
      mismatchedKeys.add(key);
      conflicts.push({
        reason: 'reservation_owner_mismatch',
        emoji_key: key,
        reservation_project_slug: live.project_slug,
        conflicting_project_slug: snapshot.project_slug,
        entity_id: null,
      });
    }
  }

  const mergedByKey = new Map(
    mergeProjectEmojiReservations(liveReservations, snapshotReservations).map((row) => [
      row.emoji_key,
      row,
    ]),
  );
  conflicts.push(...markerConflicts(snapshotSqlite, mergedByKey, mismatchedKeys));
  const sorted = sortReservationConflicts(conflicts);
  if (sorted.length > 0)
    throw domainError('EMOJI_CONFLICT', 'Restored markers conflict with permanent reservations', {
      conflicts: sorted,
    });
}
