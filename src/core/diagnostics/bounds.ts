/** List bounds for diagnostic details (spec 004 FR-021). A cut list reports what it left out. */
export const diagnosticBounds = {
  issues: 10,
  hints: 10,
  blockers: 10,
  occurrenceIds: 10,
  allowed: 20,
  names: 10,
  nameLength: 64,
} as const;

export function cutList<T>(items: readonly T[], limit: number): { items: T[]; omitted: number } {
  return { items: items.slice(0, limit), omitted: Math.max(0, items.length - limit) };
}
