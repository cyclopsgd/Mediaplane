import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeExec } from '@mediaplane/engine';
import { BUSYBOX, docker, publishedPort, removeOrIgnoreMissing } from './helpers';

/**
 * A made-up indexer for the indexer test, so that it never touches a real one: a minimal
 * Torznab feed (Prowlarr's "Generic Torznab"), served by busybox httpd on a network of its
 * own, outside the stack, as an indexer on the internet would be. It knows two made-up
 * items, a TV episode and a film, whatever it is asked.
 *
 * Its protected feed stands in for a site behind Cloudflare: a client without its
 * clearance cookie gets Cloudflare's challenge (a 503 from `Server: cloudflare`), but a
 * browser gets the feed and the cookie. Prowlarr sees the challenge, has the indexer
 * proxy's browser (Byparr's or FlareSolverr's) fetch the page, and asks again with the
 * cookie it got. A browser is told apart by the header it sends when it opens a page,
 * which Prowlarr's own requests don't (Upgrade-Insecure-Requests).
 */
export interface FakeIndexer {
  /** Where the stack's containers reach it: the network's gateway, and its port there. */
  url: string;
  /** The API path of the open feed, and of the protected one, as Prowlarr takes them. */
  open: string;
  protected: string;
  /**
   * How many times a browser has passed the protected feed's challenge. Docker writes the
   * feed's log as it comes, so it is read again every 250 ms until the count is at least
   * `atLeast` (0 unless given), for up to 10 s; then it gives the count it saw last.
   */
  browserVisits(atLeast?: number): Promise<number>;
  /**
   * Remove the container, the network and the files. Safe to call more than once: once it
   * has worked it does nothing, and after a failure it tries every removal again.
   */
  remove(): Promise<void>;
}

/** What the fake indexer logs when a browser passes its challenge. */
const PASSED = 'fake-indexer: a browser passed the challenge';
/** How long browserVisits waits for the count it is asked for, and how often it reads. */
const VISITS_WAIT_MS = 10_000;
const VISITS_EVERY_MS = 250;

/**
 * The CGI script behind both feeds. The header ends in CRLF, as Node's fetch insists. A
 * challenge is answered with its own status line, which busybox httpd passes on. The feed
 * is application/xml: a browser would download application/rss+xml rather than show it.
 */
const SCRIPT = [
  '#!/bin/sh',
  'case "$SCRIPT_NAME" in',
  '  */protected)',
  '    case "$HTTP_COOKIE" in',
  '      *cf_clearance=fake-clearance*) ;;',
  '      *)',
  '        if [ "$HTTP_UPGRADE_INSECURE_REQUESTS" = 1 ]; then',
  `          echo '${PASSED}' >&2`,
  "          printf 'Set-Cookie: cf_clearance=fake-clearance; Path=/\\r\\n'",
  '        else',
  "          printf 'HTTP/1.1 503 Service Unavailable\\r\\nServer: cloudflare\\r\\nContent-Type: text/html\\r\\n\\r\\n'",
  "          printf '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body></body></html>\\n'",
  '          exit 0',
  '        fi',
  '        ;;',
  '    esac',
  '    ;;',
  'esac',
  "printf 'Content-Type: application/xml\\r\\n\\r\\n'",
  'case "$QUERY_STRING" in',
  '  *t=caps*)',
  "    cat <<'EOF'",
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<caps>',
  '  <server title="Fake indexer"/>',
  '  <limits max="100" default="100"/>',
  '  <searching>',
  '    <search available="yes" supportedParams="q"/>',
  '    <tv-search available="yes" supportedParams="q,season,ep"/>',
  '    <movie-search available="yes" supportedParams="q"/>',
  '  </searching>',
  '  <categories>',
  '    <category id="2000" name="Movies"/>',
  '    <category id="5000" name="TV"/>',
  '  </categories>',
  '</caps>',
  'EOF',
  '    ;;',
  '  *)',
  "    cat <<'EOF'",
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">',
  '  <channel>',
  '    <title>Fake indexer</title>',
  ...[
    ['1', 'Mediaplane Test Show S01E01', '5000'],
    ['2', 'Mediaplane Test Movie 2026', '2000'],
  ].flatMap(([id = '', title = '', category = '']) => [
    '    <item>',
    `      <title>${title}</title>`,
    `      <guid>fake-indexer-${id}</guid>`,
    `      <link>http://indexer.invalid/fake/${id}.torrent</link>`,
    '      <pubDate>Thu, 01 Oct 2026 12:00:00 +0000</pubDate>',
    '      <size>1073741824</size>',
    `      <enclosure url="http://indexer.invalid/fake/${id}.torrent" length="1073741824" type="application/x-bittorrent"/>`,
    `      <torznab:attr name="category" value="${category}"/>`,
    '      <torznab:attr name="seeders" value="10"/>',
    '      <torznab:attr name="peers" value="12"/>',
    '    </item>',
  ]),
  '  </channel>',
  '</rss>',
  'EOF',
  '    ;;',
  'esac',
  '',
].join('\n');

/** Start the fake indexer, as `<id>-indexer` on `<id>-indexer-net`. */
export async function startFakeIndexer(id: string): Promise<FakeIndexer> {
  const network = `${id}-indexer-net`;
  const container = `${id}-indexer`;
  const dir = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-indexer-'));
  // Set only once every removal has worked, so a call after a failure tries them again.
  let removed = false;
  const remove = async () => {
    if (removed) return;
    // Every removal runs, even when one before it fails; the failures are reported after.
    const failures: unknown[] = [];
    for (const step of [
      () => removeOrIgnoreMissing('rm', '-f', '-v', container),
      () => removeOrIgnoreMissing('network', 'rm', network),
      // The server only reads its files: they are this user's.
      () => rm(dir, { recursive: true, force: true }),
    ]) {
      try {
        await step();
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `could not remove all of ${id}'s fake indexer`);
    }
    removed = true;
  };
  const visits = async () => {
    const logs = await nodeExec('docker', ['logs', container], {
      cwd: '/',
      timeoutMs: 120_000,
    });
    if (logs.code !== 0) throw new Error(`docker logs failed:\n${logs.stderr}`);
    return (logs.stdout + logs.stderr).split('\n').filter((l) => l === PASSED).length;
  };
  try {
    await mkdir(join(dir, 'www', 'cgi-bin'), { recursive: true });
    for (const feed of ['api', 'protected']) {
      const path = join(dir, 'www', 'cgi-bin', feed);
      await writeFile(path, SCRIPT);
      await chmod(path, 0o755);
    }
    await docker('network', 'create', network);
    const gateway = await docker(
      'network',
      'inspect',
      '--format',
      '{{range .IPAM.Config}}{{.Gateway}}{{end}}',
      network,
    );
    // --init: busybox httpd as PID 1 would not stop on SIGTERM.
    await docker(
      'run',
      '-d',
      '--init',
      '--name',
      container,
      '--network',
      network,
      '-p',
      `${gateway}::80`,
      '-v',
      `${join(dir, 'www')}:/www:ro`,
      BUSYBOX,
      'httpd',
      '-f',
      '-p',
      '80',
      '-h',
      '/www',
    );
    return {
      url: `http://${gateway}:${String(await publishedPort(container, '80/tcp'))}`,
      open: '/cgi-bin/api',
      protected: '/cgi-bin/protected',
      browserVisits: async (atLeast = 0) => {
        const deadline = Date.now() + VISITS_WAIT_MS;
        for (;;) {
          const count = await visits();
          if (count >= atLeast || Date.now() >= deadline) return count;
          await new Promise((done) => setTimeout(done, VISITS_EVERY_MS));
        }
      },
      remove,
    };
  } catch (cause) {
    try {
      await remove();
    } catch (cleanup) {
      throw new AggregateError(
        [cause, cleanup],
        'the fake indexer failed to start, and cleaning up failed too',
        { cause: cleanup },
      );
    }
    throw cause;
  }
}
