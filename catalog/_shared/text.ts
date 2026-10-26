/**
 * `text` with `section` after it, as a block of its own: after a blank line, on a line of
 * its own however `text` ends, or alone when `text` is empty. `section` ends with its own
 * newline. For a key put back in an app's file that has nowhere for it yet.
 */
export function appendSection(text: string, section: string): string {
  const end = text === '' || text.endsWith('\n') ? '' : '\n';
  return `${text}${end}${text === '' ? '' : '\n'}${section}`;
}
