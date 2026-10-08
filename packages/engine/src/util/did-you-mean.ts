/** Levenshtein distance (single-row dynamic programming; inputs are short). */
export function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j] ?? 0;
      const left = row[j - 1] ?? 0;
      row[j] = a[i - 1] === b[j - 1] ? diagonal : 1 + Math.min(diagonal, above, left);
      diagonal = above;
    }
  }
  return row[b.length] ?? 0;
}

/** The closest candidate within an edit distance of 2 (case-insensitive), if any. */
export function didYouMean(
  input: string,
  candidates: readonly string[],
): string | undefined {
  let best: { candidate: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = editDistance(input.toLowerCase(), candidate.toLowerCase());
    if (distance <= 2 && (best === undefined || distance < best.distance)) {
      best = { candidate, distance };
    }
  }
  return best?.candidate;
}
