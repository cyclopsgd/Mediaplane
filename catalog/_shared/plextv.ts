/**
 * What a failure to call plex.tv at all says (a helper or Docker error, not plex.tv's
 * answer): only the kind of error. Its own text is never shown, as what the helper or
 * Docker said may hold anything.
 */
export function failedCall(cause: unknown): string {
  return `the call to plex.tv failed (${cause instanceof Error ? cause.name : 'not an Error'})`;
}
