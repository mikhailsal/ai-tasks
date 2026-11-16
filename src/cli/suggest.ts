/** Optimal string alignment distance (Damerau-Levenshtein with adjacent transpositions). */
export function editDistance(a: string, b: string): number {
  const width = b.length + 1;
  const cells = new Array<number>((a.length + 1) * width).fill(0);
  const at = (i: number, j: number): number => cells[i * width + j] ?? 0;
  for (let i = 0; i <= a.length; i += 1) cells[i * width] = i;
  for (let j = 0; j <= b.length; j += 1) cells[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, at(i - 2, j - 2) + 1);
      }
      cells[i * width + j] = best;
    }
  }
  return at(a.length, b.length);
}

/** Up to three known names within a distance that scales with length; never invents names. */
export function suggestNames(input: string, known: readonly string[], limit = 3): string[] {
  const threshold = Math.max(1, Math.floor(input.length / 3));
  return known
    .map((name) => ({ name, distance: editDistance(input, name) }))
    .filter((entry) => entry.distance <= threshold)
    .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name))
    .slice(0, limit)
    .map((entry) => entry.name);
}
