/**
 * A key's name, "<app>.<name>" ("sonarr.apiKey"), as the store, plan and keep name it:
 * the app, and the key's name in it. App ids hold no ".", so what comes before the first
 * is the app, and the rest is the name; one with no "." is an app with no name.
 */
export function splitKey(key: string): { app: string; name: string } {
  const at = key.indexOf('.');
  return at < 0
    ? { app: key, name: '' }
    : { app: key.slice(0, at), name: key.slice(at + 1) };
}
