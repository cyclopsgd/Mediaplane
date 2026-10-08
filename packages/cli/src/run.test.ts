import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import { detectHostFacts, plan } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { run, type Io } from './run';
import { VERSION } from './version';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: {}
  qbittorrent: {}
`;

async function makeHome(stack = STACK): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-cli-'));
  await mkdir(join(home, 'secrets'));
  await writeFile(join(home, 'secrets', 'wg.key'), 'fake-wireguard-key-for-tests\n');
  await writeFile(join(home, 'stack.yaml'), stack);
  return home;
}

function capture(env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    env,
  };
  return { io, stdout: () => out.join(''), stderr: () => err.join('') };
}

describe('mediaplane plan', () => {
  it('exits 2 and lists compose.yaml as new in a fresh home', async () => {
    const term = capture();
    expect(await run(['plan', '--home', await makeHome()], term.io)).toBe(2);
    expect(term.stdout()).toContain('+ generated/compose.yaml');
    expect(term.stdout()).toContain('Plan: 1 file(s) to write.');
  });

  it('prints versioned JSON without file contents', async () => {
    const term = capture();
    expect(await run(['plan', '--home', await makeHome(), '--json'], term.io)).toBe(2);
    const json = JSON.parse(term.stdout()) as {
      schema: string;
      ok: boolean;
      changed: boolean;
      files: Record<string, unknown>[];
    };
    expect(json).toMatchObject({ schema: 'mediaplane.plan/v1', ok: true, changed: true });
    expect(json.files[0]).toMatchObject({
      path: 'generated/compose.yaml',
      status: 'create',
    });
    expect(json.files[0]).not.toHaveProperty('content');
  });

  it('exits 0 when nothing would change', async () => {
    const home = await makeHome();
    const current = await plan({ home, catalog, host: detectHostFacts(), env: {} });
    await mkdir(join(home, 'generated'));
    await writeFile(
      join(home, 'generated', 'compose.yaml'),
      current.files[0]?.content ?? '',
    );
    const term = capture();
    expect(await run(['plan', '--home', home], term.io)).toBe(0);
    expect(term.stdout()).toContain('No changes.');
  });

  it('exits 1 with actionable errors on stderr', async () => {
    const term = capture();
    const home = await makeHome(STACK.replace('sonarr: {}', 'sonar: {}'));
    expect(await run(['plan', '--home', home], term.io)).toBe(1);
    expect(term.stderr()).toContain('error: unknown app "sonar"');
    expect(term.stderr()).toContain('hint: did you mean "sonarr"?');
  });

  it('reads the home directory from MEDIAPLANE_HOME', async () => {
    const term = capture({ MEDIAPLANE_HOME: await makeHome() });
    expect(await run(['plan'], term.io)).toBe(2);
  });

  it('prints its version', async () => {
    const term = capture();
    expect(await run(['--version'], term.io)).toBe(0);
    expect(term.stdout().trim()).toBe(VERSION);
  });

  it('reports unexpected I/O errors as a one-line error instead of crashing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-cli-'));
    await mkdir(join(home, 'stack.yaml'));
    const term = capture();
    expect(await run(['plan', '--home', home], term.io)).toBe(1);
    expect(term.stderr()).toMatch(/^error: /);
    expect(term.stderr()).toContain('EISDIR');
    expect(term.stdout()).toBe('');
  });
});
