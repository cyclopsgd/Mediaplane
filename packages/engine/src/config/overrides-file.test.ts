import { chmod, link, mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../testing/temp';
import { overrideLine, stackFileProblem, withOverride } from './overrides-file';
import { starterStack } from './starter';

const KEY = 'sonarr.download_client.category';

/** The stack of spec §4.2's example: comments lined up after values, and a blank line. */
const SPEC = `# yaml-language-server: $schema=https://example.invalid/stack.schema.json
version: 1
timezone: Europe/London
user: { uid: 1000, gid: 1000 }
paths: { data: /srv/data }
network: { bind: lan, lan_subnet: 192.168.1.0/24 }   # lan | localhost | all
media_server: jellyfin                                 # jellyfin | plex

apps:
  sonarr: {}
  radarr: { port: 7879 }        # escape hatches: port, version, env
  qbittorrent: { vpn: false }
overrides:                      # written by "Keep mine"
  radarr.download_client.category: films   # mine
# managed_by: external          # Mediaplane never writes this file
`;

/** `source` with `line` inserted after its line number `after` (1 based). */
function inserted(source: string, after: number, line: string): string {
  const lines = source.split('\n');
  lines.splice(after, 0, line);
  return lines.join('\n');
}

function written(
  source: string,
  key = KEY,
  value: string | number | boolean = 'television',
) {
  const result = withOverride(source, key, value);
  if (!result.ok) throw new Error(result.reason);
  return result.text;
}

describe('withOverride', () => {
  it('adds the line after the last override, changing nothing else, its comments neither', () => {
    expect(written(SPEC)).toBe(
      inserted(SPEC, 14, '  sonarr.download_client.category: television'),
    );
  });

  it("adds overrides: at the end of init's starter file, which has none", () => {
    const starter = starterStack({
      mediaServer: 'jellyfin',
      dataPath: '/srv/data',
      vpnProvider: 'mullvad',
      vpnAddresses: '10.64.0.2/32',
      loginOnLan: true,
      timezone: 'Europe/London',
      user: { uid: 1000, gid: 1000 },
      bind: 'lan',
      lanSubnet: undefined,
      adminUser: 'admin',
      adminPasswordFile: undefined,
    });
    expect(written(starter)).toBe(
      `${starter}overrides:\n  sonarr.download_client.category: television\n`,
    );
    // Without a last line end, and with Windows line ends, as the file has them.
    const bare =
      'version: 1\npaths: { data: /srv/data }\nmedia_server: jellyfin\napps: { sonarr: {}, qbittorrent: { vpn: false } }';
    expect(written(bare)).toBe(`${bare}\noverrides:\n  ${KEY}: television\n`);
    const crlf =
      'version: 1\r\npaths: { data: /srv/data }\r\nmedia_server: jellyfin\r\napps:\r\n  sonarr: {}\r\n  qbittorrent: { vpn: false }\r\n';
    expect(written(crlf)).toBe(`${crlf}overrides:\r\n  ${KEY}: television\r\n`);
  });

  it('keeps the indentation of the overrides there are, and their line ends', () => {
    const deep =
      'version: 1\npaths:\n    data: /srv/data\nmedia_server: jellyfin\napps:\n    sonarr: {}\n    qbittorrent: { vpn: false }\noverrides:\n    a.b.c: 1\n';
    expect(written(deep)).toBe(`${deep.slice(0, -1)}\n    ${KEY}: television\n`);
    const crlf =
      'version: 1\r\npaths: { data: /srv/data }\r\nmedia_server: jellyfin\r\napps: { sonarr: {}, qbittorrent: { vpn: false } }\r\noverrides:\r\n  a.b.c: 1 # one\r\n# end\r\n';
    expect(written(crlf)).toBe(
      'version: 1\r\npaths: { data: /srv/data }\r\nmedia_server: jellyfin\r\napps: { sonarr: {}, qbittorrent: { vpn: false } }\r\noverrides:\r\n  a.b.c: 1 # one\r\n  sonarr.download_client.category: television\r\n# end\r\n',
    );
  });

  it('adds the line after an override written as a block of lines', () => {
    const head =
      'version: 1\npaths: { data: /srv/data }\nmedia_server: jellyfin\napps: { sonarr: {}, qbittorrent: { vpn: false } }\n';
    expect(
      written(
        `${head}overrides:\n  a.b.c: |-\n    two\n    lines\nmanaged_by: mediaplane\n`,
      ),
    ).toBe(
      `${head}overrides:\n  a.b.c: |-\n    two\n    lines\n  ${KEY}: television\nmanaged_by: mediaplane\n`,
    );
    expect(written(`${head}overrides:\n  a.b.c: >\n    folded\n`)).toBe(
      `${head}overrides:\n  a.b.c: >\n    folded\n  ${KEY}: television\n`,
    );
  });

  it('replaces the value of a key kept before, where it is', () => {
    const kept = SPEC.replace(
      '  radarr.download_client.category: films   # mine',
      '  sonarr.download_client.category: "tv-old"   # mine',
    );
    expect(written(kept)).toBe(kept.replace('"tv-old"', 'television'));
  });

  it('writes into overrides: given as a flow of keys, or empty', () => {
    const head =
      'version: 1\npaths: { data: /srv/data }\nmedia_server: jellyfin\napps: { sonarr: {}, qbittorrent: { vpn: false } }\n';
    expect(written(`${head}overrides: {}\n`)).toBe(
      `${head}overrides: { ${KEY}: television }\n`,
    );
    expect(written(`${head}overrides: { a.b.c: 1 } # mine\n`)).toBe(
      `${head}overrides: { a.b.c: 1, ${KEY}: television } # mine\n`,
    );
  });

  it('writes numbers and true or false as such, and text YAML would misread quoted', () => {
    const head =
      'version: 1\npaths: { data: /srv/data }\nmedia_server: jellyfin\napps: { sonarr: {}, qbittorrent: { vpn: false } }\n';
    expect(written(head, 'sonarr.download_client.port', 8090)).toContain(
      'sonarr.download_client.port: 8090\n',
    );
    expect(written(head, 'sonarr.download_client.enable', false)).toContain(
      'sonarr.download_client.enable: false\n',
    );
    expect(written(head, KEY, 'true')).toContain(`${KEY}: "true"\n`);
    expect(overrideLine(KEY, 'two\nlines')).toBe(`${KEY}: "two\\nlines"`);
  });

  it("refuses a file it can't add to without changing more, saying why", () => {
    const reasons = (source: string) => {
      const result = withOverride(source, KEY, 'television');
      return result.ok ? 'written' : result.reason;
    };
    expect(reasons('version: [')).toBe('it is not a valid stack.yaml');
    expect(
      reasons(
        '{ version: 1, paths: { data: /srv/data }, media_server: jellyfin, apps: { sonarr: {}, qbittorrent: { vpn: false } } }\n',
      ),
    ).toBe('its top level is not a YAML block of keys, one per line');
    const head =
      'version: 1\npaths: { data: /srv/data }\nmedia_server: jellyfin\napps: { sonarr: {}, qbittorrent: { vpn: false } }\n';
    expect(reasons(`${head}---\nversion: 1\n`)).toBe('it is not a valid stack.yaml');
    // A key YAML writes as an explicit "? key", which its line can't follow as it is.
    expect(reasons(`${head}overrides:\n  ? a.b.c\n  : 1\n`)).toBe(
      "Mediaplane can't add the line there without changing more than it",
    );
    // A stack.yaml with overrides: that YAML reads as a value of its own.
    expect(reasons(`${head}overrides: &kept { a.b.c: 1 }\n`)).toBe('written');
    expect(reasons(`${head}overrides: { ${KEY}: [tv] }\n`)).toBe(
      'it is not a valid stack.yaml',
    );
  });
});

describe('stackFileProblem', () => {
  it("has none for a stack.yaml of this user's own", async () => {
    const dir = await tempDir('mediaplane-keep-');
    await writeFile(join(dir, 'stack.yaml'), 'version: 1\n');
    expect(await stackFileProblem(join(dir, 'stack.yaml'))).toBeUndefined();
  });

  it("says why it won't rewrite a link, a folder, a file with other names, or another user's", async () => {
    const dir = await tempDir('mediaplane-keep-');
    await writeFile(join(dir, 'real.yaml'), 'version: 1\n');
    await symlink(join(dir, 'real.yaml'), join(dir, 'link.yaml'));
    await link(join(dir, 'real.yaml'), join(dir, 'other.yaml'));
    await mkdir(join(dir, 'folder.yaml'));
    expect(await stackFileProblem(join(dir, 'link.yaml'))).toMatch(/^it is a link/);
    expect(await stackFileProblem(join(dir, 'folder.yaml'))).toBe(
      'it is not a regular file',
    );
    expect(await stackFileProblem(join(dir, 'real.yaml'))).toBe(
      'it has other names (hard links), which a rewrite would part from it',
    );
    await writeFile(join(dir, 'theirs.yaml'), 'version: 1\n');
    await chmod(join(dir, 'theirs.yaml'), 0o644);
    expect(await stackFileProblem(join(dir, 'theirs.yaml'), 4242)).toMatch(
      /^it belongs to uid \d+, and Mediaplane runs as uid 4242/,
    );
    // Of a group this user isn't in: the rewrite couldn't keep it.
    expect(
      await stackFileProblem(join(dir, 'theirs.yaml'), process.getuid?.(), [4242]),
    ).toMatch(/^it belongs to group \d+, which Mediaplane's user isn't in/);
  });
});
