/** The system error code of a failure ("ENOENT", "EACCES"…), when it has one. */
export function codeOf(cause: unknown): string | undefined {
  return cause instanceof Error && 'code' in cause ? String(cause.code) : undefined;
}

/** Why a read failed, by its code alone, never its message (which can hold a path). */
export function couldNotRead(code: string | undefined): string {
  return code === undefined ? 'it could not be read' : `it could not be read (${code})`;
}
