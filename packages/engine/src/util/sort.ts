/** Locale-independent string ordering, so output is identical on every machine. */
export function compare(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
