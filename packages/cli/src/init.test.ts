import { mkdtemp, open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { invokingUser, parseConfig } from '@mediaplane/engine';
import { FIXTURE_HOST, fakeProbe, fakeRuntime } from '@mediaplane/engine/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { run, type CliDeps, type Io } from './run';

// writeFile() and open() pass straight through, except where a test fills the disk
// halfway through writing stack.yaml (which can't be provoked reliably otherwise).
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return { ...actual, writeFile: vi.fn(actual.writeFile), open: vi.fn(actual.open) };
});
const real = await vi.importActual<typeof FsPromises>('node:fs/promises');

beforeEach(() => {
  vi.mocked(writeFile).mockReset();
  vi.mocked(open).mockReset();
});

/**
 * The next file write stops halfway on a full disk, whether it goes through writeFile()
 * or through a handle from open().
 */
function fillDiskOnNextWrite(): void {
  const full = () =>
    Object.assign(new Error('fake: no space left on device'), { code: 'ENOSPC' });
  // init writes text; the first 20 characters make it to the disk.
  const half = (data: unknown) => (typeof data === 'string' ? data.slice(0, 20) : '');
  vi.mocked(writeFile).mockImplementationOnce(async (path, data, options) => {
    await real.writeFile(path, half(data), options);
    throw full();
  });
  vi.mocked(open).mockImplementationOnce(async (...args) => {
    const handle = await real.open(...args);
    vi.spyOn(handle, 'writeFile').mockImplementationOnce(async (data) => {
      await handle.write(half(data));
      throw full();
    });
    return handle;
  });
}

function capture(answers?: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    env: {},
    ...(answers === undefined
      ? {}
      : { ask: () => Promise.resolve(answers.shift() ?? '') }),
  };
  return { io, stdout: () => out.join(''), stderr: () => err.join('') };
}

const deps = (cloud?: string): Partial<CliDeps> => ({
  host: () =>
    Promise.resolve(cloud === undefined ? FIXTURE_HOST : { ...FIXTURE_HOST, cloud }),
  runtime: () => fakeRuntime(),
  probe: () => fakeProbe(),
});

const newHome = () => mkdtemp(join(tmpdir(), 'mediaplane-init-'));

async function stackIn(home: string) {
  const result = parseConfig(await readFile(join(home, 'stack.yaml'), 'utf8'));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.config;
}

describe('mediaplane init', () => {
  it('writes a starter stack and a private secrets folder from flags', async () => {
    const home = await newHome();
    const term = capture();
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'jellyfin',
      '--data',
      '/srv/data',
      '--vpn-provider',
      'mullvad',
      '--timezone',
      'Europe/London',
    ];
    expect(await run(args, term.io, deps())).toBe(0);
    expect(await stackIn(home)).toMatchObject({
      media_server: 'jellyfin',
      paths: { data: '/srv/data' },
      network: { bind: 'lan' },
      vpn: { provider: 'mullvad' },
    });
    expect((await stat(join(home, 'secrets'))).mode & 0o777).toBe(0o700);
    expect(term.stdout()).toContain(`Wrote ${join(home, 'stack.yaml')}.`);
    expect(term.stdout()).toContain(
      `Put your VPN's WireGuard private key in ${join(home, 'secrets', 'wg.key')}.`,
    );
    const { uid, gid } = invokingUser();
    expect((await stackIn(home)).user).toEqual({ uid, gid });
    expect(term.stdout()).toContain(
      `Create /srv/data and make sure uid ${String(uid)} (gid ${String(gid)}) can write to it.`,
    );
  });

  it('never overwrites an existing stack.yaml', async () => {
    const home = await newHome();
    await writeFile(join(home, 'stack.yaml'), 'version: 1\n');
    const term = capture();
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'jellyfin',
      '--data',
      '/srv/data',
    ];
    expect(await run(args, term.io, deps())).toBe(1);
    expect(term.stderr()).toContain('already exists; init never overwrites it');
    expect(await readFile(join(home, 'stack.yaml'), 'utf8')).toBe('version: 1\n');
    expect(await readdir(home)).toEqual(['stack.yaml']);
  });

  it('never leaves a half-written stack.yaml behind', async () => {
    const home = await newHome();
    fillDiskOnNextWrite();
    const term = capture();
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'jellyfin',
      '--data',
      '/srv/data',
    ];
    expect(await run(args, term.io, deps())).toBe(1);
    expect(term.stderr()).toBe('error: fake: no space left on device\n');
    expect(await readdir(home)).toEqual([]);
    // With room on the disk, a second try writes it.
    expect(await run(args, capture().io, deps())).toBe(0);
    expect((await readdir(home)).sort()).toEqual(['secrets', 'stack.yaml']);
  });

  it('needs flags when it cannot ask', async () => {
    const term = capture();
    expect(await run(['init', '--home', await newHome()], term.io, deps())).toBe(1);
    expect(term.stderr()).toContain('init needs --media-server and --data');
  });

  it('asks on a terminal for what the flags leave out', async () => {
    const home = await newHome();
    const term = capture(['plex', '/srv/media', '', 'n']);
    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
    const config = await stackIn(home);
    expect(config).toMatchObject({
      media_server: 'plex',
      paths: { data: '/srv/media' },
      security: { login_on_lan: false },
    });
    expect(config.vpn).toBeUndefined();
    expect(term.stdout()).toContain(
      `Save your Plex token in ${join(home, 'secrets', 'plex-token')}.`,
    );
  });

  it('keeps the web UIs on localhost on a cloud VM', async () => {
    const home = await newHome();
    const term = capture();
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'jellyfin',
      '--data',
      '/srv/data',
    ];
    expect(await run(args, term.io, deps('Oracle Cloud'))).toBe(0);
    expect((await stackIn(home)).network.bind).toBe('localhost');
    expect(term.stdout()).toContain(
      'This looks like a VM on Oracle Cloud, so the web UIs stay on localhost (network.bind).\n',
    );
  });

  it('reports an invalid answer and writes nothing', async () => {
    const home = await newHome();
    const term = capture();
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'jellyfin',
      '--data',
      'relative/path',
    ];
    expect(await run(args, term.io, deps())).toBe(1);
    expect(term.stderr()).toContain('must be an absolute path');
    await expect(stat(join(home, 'stack.yaml'))).rejects.toThrow();
  });

  it('prints versioned JSON', async () => {
    const home = await newHome();
    const term = capture();
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'jellyfin',
      '--data',
      '/srv/data',
      '--json',
    ];
    expect(await run(args, term.io, deps())).toBe(0);
    expect(JSON.parse(term.stdout())).toMatchObject({
      schema: 'mediaplane.init/v1',
      ok: true,
      stackPath: join(home, 'stack.yaml'),
    });
  });
});
