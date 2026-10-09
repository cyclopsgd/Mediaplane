import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { portKey } from '../preflight/checks';
import type { HostProbe } from '../preflight/probe';
import { RuntimeError, type Runtime } from '../runtime/types';
import { SECRETS_PATH } from '../secrets/store';
import { fakeHash, fakeProbe, fakeRuntime, running } from '../testing/fakes';
import { FIXTURE_HOST, fixtureCatalog } from '../testing/fixtures';
import { COMPOSE_PATH, plan } from './plan';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  qbittorrent: {}
  sonarr: {}
`;

const SERVICES = ['gluetun', 'jellyfin', 'qbittorrent', 'sonarr'];
const HASHES = Object.fromEntries(SERVICES.map((s, i) => [s, String(i).repeat(64)]));

async function makeHome({
  stack = STACK,
  withSecret = true,
  withStore = false,
} = {}): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-plan-'));
  await writeFile(join(home, 'stack.yaml'), stack);
  if (withSecret) {
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'wg.key'), 'fake-wireguard-key-for-tests\n');
  }
  if (withStore) {
    await mkdir(join(home, 'state'));
    await writeFile(
      join(home, SECRETS_PATH),
      JSON.stringify({ version: 1, apps: { sonarr: { apiKey: '0'.repeat(32) } } }),
    );
  }
  return home;
}

function planFor(
  home: string,
  {
    runtime = fakeRuntime(),
    probe = fakeProbe(),
  }: { runtime?: Runtime; probe?: HostProbe } = {},
) {
  return plan({
    home,
    catalog: fixtureCatalog,
    host: FIXTURE_HOST,
    env: {},
    runtime,
    probe,
  });
}

describe('plan', () => {
  it('plans files, containers and secrets for a fresh home', async () => {
    const result = await planFor(await makeHome());
    expect(result).toMatchObject({ ok: true, changed: true, diagnostics: [] });
    expect(result.files).toEqual([
      expect.objectContaining({ path: COMPOSE_PATH, status: 'create' }),
    ]);
    expect(result.files[0]?.content).toContain('name: mediaplane');
    expect(result.containers).toEqual(
      SERVICES.map((service) => ({ service, action: 'create' })),
    );
    expect(result.secrets).toEqual({ generate: ['sonarr.apiKey'] });
  });

  it('reports no changes when files, containers and secrets are current', async () => {
    const home = await makeHome({ withStore: true });
    const runtime = fakeRuntime({
      hashes: { ok: true, hashes: HASHES },
      containers: running(HASHES),
    });
    const first = await planFor(home, { runtime });
    await mkdir(join(home, 'generated'));
    await writeFile(join(home, COMPOSE_PATH), first.files[0]?.content ?? '');
    const result = await planFor(home, { runtime });
    expect(result).toMatchObject({ ok: true, changed: false, secrets: { generate: [] } });
    expect(result.files).toEqual([expect.objectContaining({ status: 'unchanged' })]);
    expect(result.containers.every((c) => c.action === 'unchanged')).toBe(true);
  });

  it('keeps the VPN guest unchanged when it and its host are current', async () => {
    const home = await makeHome({ withStore: true });
    const asked: { compose: string; values: Record<string, string> }[] = [];
    const base = fakeRuntime();
    const runtime: Runtime = {
      ...base,
      configHashes: (compose, values) => {
        asked.push({ compose, values });
        return base.configHashes(compose, values);
      },
    };
    await planFor(home, { runtime });
    const { compose, values } = asked[0] ?? { compose: '', values: {} };
    // Compose records qbittorrent's hash with gluetun's container ID in its network_mode.
    const guest = compose.replace(
      'network_mode: service:gluetun',
      'network_mode: container:fake-gluetun',
    );
    const labels = {
      ...fakeHash(compose, values),
      qbittorrent: fakeHash(guest, values).qbittorrent ?? '',
    };
    const result = await planFor(home, {
      runtime: fakeRuntime({ containers: running(labels) }),
    });
    expect(result.containers).toEqual(
      SERVICES.map((service) => ({ service, action: 'unchanged' })),
    );
  });

  it('never writes to the home directory', async () => {
    const home = await makeHome();
    const before = (await readdir(home, { recursive: true })).sort();
    await planFor(home);
    expect((await readdir(home, { recursive: true })).sort()).toEqual(before);
  });

  it('explains a Docker it cannot reach', async () => {
    const runtime = fakeRuntime({
      unavailable: 'cannot talk to Docker: connection refused',
    });
    const result = await planFor(await makeHome(), { runtime });
    expect(result).toMatchObject({
      ok: false,
      changed: false,
      files: [],
      containers: [],
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'docker.unavailable',
        message: 'cannot talk to Docker: connection refused',
      }),
    );
  });

  it('explains a Docker that stops answering while predicting containers', async () => {
    const runtime: Runtime = {
      ...fakeRuntime(),
      configHashes: () =>
        Promise.reject(
          new RuntimeError('docker compose config did not finish within 60s'),
        ),
    };
    const result = await planFor(await makeHome(), { runtime });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'docker.unavailable',
        message: 'docker compose config did not finish within 60s',
      }),
    );
  });

  it('stops on a preflight error', async () => {
    const probe = fakeProbe({ busyPorts: [portKey('tcp', '127.0.0.1', 8989)] });
    const result = await planFor(await makeHome(), { probe });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'preflight.port-in-use' })],
    });
  });

  it('reports a configuration Compose rejects', async () => {
    const runtime = fakeRuntime({
      hashes: { ok: false, error: 'services.sonarr.ports must be a list' },
    });
    const result = await planFor(await makeHome(), { runtime });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'compose.invalid',
        message:
          'docker compose rejected the configuration: services.sonarr.ports must be a list',
      }),
    );
  });

  it('rejects a home path containing ":"', async () => {
    const result = await plan({
      home: '/tmp/a:b',
      catalog: fixtureCatalog,
      host: FIXTURE_HOST,
      env: {},
      runtime: fakeRuntime(),
      probe: fakeProbe(),
    });
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'home.invalid' }] });
  });

  it('fails with the config error when stack.yaml is missing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-plan-'));
    expect(await planFor(home)).toMatchObject({
      ok: false,
      changed: false,
      files: [],
      diagnostics: [{ code: 'config.missing' }],
    });
  });

  it('fails when a referenced secret is missing', async () => {
    expect(await planFor(await makeHome({ withSecret: false }))).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({ code: 'secret.missing', path: 'vpn.private_key' }),
      ],
    });
  });

  it('fails when the stack does not resolve', async () => {
    const stack = STACK.replace('  qbittorrent: {}\n', '');
    expect(await planFor(await makeHome({ stack }))).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'app.missing-capability' })],
    });
  });
});
