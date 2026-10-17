// The nightly Plex job's last step, which runs whether or not the tests passed: remove
// from the test account every server the run noted, so that offline servers never pile
// up there. It prints counts only, never a token or a machine identifier.
import { notedServers, PLEX_TOKEN_FILE, plexToken, removeServers } from './plex-account';

if (PLEX_TOKEN_FILE === undefined) {
  console.log('No plex.tv token: nothing to remove.');
} else {
  const noted = await notedServers();
  const { removed, absent } = await removeServers(await plexToken(), noted);
  console.log(
    `Servers noted: ${String(noted.length)}; removed: ${String(removed.length)}; not on the account any more: ${String(absent.length)}.`,
  );
}
