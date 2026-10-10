/** The system error code of a failure ("ENOENT", "EACCES"…), when it has one. */
export function codeOf(cause: unknown): string | undefined {
  return cause instanceof Error && 'code' in cause ? String(cause.code) : undefined;
}
