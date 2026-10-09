import { describe, expect, it } from 'vitest';
import type { ComposeFile, ComposeService } from '../render/compose';
import { composeToYaml } from '../render/yaml';
import type { ContainerState, HashesResult, Runtime } from '../runtime/types';
import { fakeHash, fakeRuntime } from '../testing/fakes';
import { predictContainers } from './predict';

const VALUES = { MP_FAKE_SECRET: 'fake-secret-value' };
const STALE = '0'.repeat(64);

function service(extra: Partial<ComposeService> = {}): ComposeService {
  return {
    image: 'registry.test/app:1',
    restart: 'unless-stopped',
    labels: {},
    ...extra,
  };
}

/** qbittorrent shares gluetun's network namespace; sonarr stands alone. */
const COMPOSE: ComposeFile = {
  name: 'mediaplane',
  services: {
    gluetun: service(),
    qbittorrent: service({ network_mode: 'service:gluetun' }),
    sonarr: service(),
  },
};

function idOf(service: string): string {
  return service.padEnd(64, '0');
}

/** The compose with qbittorrent pointed at gluetun's container, as Compose hashes it. */
function withHostId(id: string): ComposeFile {
  return {
    ...COMPOSE,
    services: {
      ...COMPOSE.services,
      qbittorrent: service({ network_mode: `container:${id}` }),
    },
  };
}

function hashesOf(compose: ComposeFile): Record<string, string> {
  return fakeHash(composeToYaml(compose), VALUES);
}

function container(
  service: string,
  configHash: string | undefined,
  extra: Partial<ContainerState> = {},
): ContainerState {
  return {
    service,
    id: idOf(service),
    state: 'running',
    health: '',
    configHash,
    published: [],
    ...extra,
  };
}

/** fakeRuntime, recording the compose files it is asked to hash. */
function recording(runtime: Runtime = fakeRuntime()) {
  const composes: string[] = [];
  return {
    composes,
    runtime: {
      ...runtime,
      configHashes: (compose: string, values: Record<string, string>) => {
        composes.push(compose);
        return runtime.configHashes(compose, values);
      },
    },
  };
}

/** Every container current: labels as Compose records them, guest by host ID. */
function currentContainers(extra: Partial<ContainerState> = {}): ContainerState[] {
  const plain = hashesOf(COMPOSE);
  const guest = hashesOf(withHostId(idOf('gluetun')));
  return [
    container('gluetun', plain.gluetun, extra),
    container('qbittorrent', guest.qbittorrent, extra),
    container('sonarr', plain.sonarr, extra),
  ];
}

describe('predictContainers', () => {
  it("keeps a guest whose label matches the hash with its host's container ID", async () => {
    const { runtime, composes } = recording();
    // The hash of the compose as written never matches a guest's label.
    expect(hashesOf(COMPOSE).qbittorrent).not.toBe(
      hashesOf(withHostId(idOf('gluetun'))).qbittorrent,
    );
    expect(
      await predictContainers(COMPOSE, VALUES, runtime, currentContainers()),
    ).toEqual({
      ok: true,
      changes: [
        { service: 'gluetun', action: 'unchanged' },
        { service: 'qbittorrent', action: 'unchanged' },
        { service: 'sonarr', action: 'unchanged' },
      ],
    });
    expect(composes).toHaveLength(2);
    expect(composes[1]).toContain(`network_mode: container:${idOf('gluetun')}`);
  });

  it('starts a stopped guest behind a stopped host', async () => {
    const result = await predictContainers(
      COMPOSE,
      VALUES,
      fakeRuntime(),
      currentContainers({ state: 'exited' }),
    );
    expect(result).toEqual({
      ok: true,
      changes: [
        { service: 'gluetun', action: 'start' },
        { service: 'qbittorrent', action: 'start' },
        { service: 'sonarr', action: 'start' },
      ],
    });
  });

  it('recreates a guest whose own configuration changed', async () => {
    const current = currentContainers().map((c) =>
      c.service === 'qbittorrent' ? { ...c, configHash: STALE } : c,
    );
    expect(await predictContainers(COMPOSE, VALUES, fakeRuntime(), current)).toEqual({
      ok: true,
      changes: [
        { service: 'gluetun', action: 'unchanged' },
        { service: 'qbittorrent', action: 'recreate' },
        { service: 'sonarr', action: 'unchanged' },
      ],
    });
  });

  it('recreates a guest whose host is recreated', async () => {
    const { runtime, composes } = recording();
    const current = currentContainers().map((c) =>
      c.service === 'gluetun' ? { ...c, configHash: STALE } : c,
    );
    expect(await predictContainers(COMPOSE, VALUES, runtime, current)).toEqual({
      ok: true,
      changes: [
        { service: 'gluetun', action: 'recreate' },
        { service: 'qbittorrent', action: 'recreate' },
        { service: 'sonarr', action: 'unchanged' },
      ],
    });
    expect(composes).toHaveLength(1);
  });

  it('creates a guest whose host is created', async () => {
    const { runtime, composes } = recording();
    expect(await predictContainers(COMPOSE, VALUES, runtime, [])).toEqual({
      ok: true,
      changes: [
        { service: 'gluetun', action: 'create' },
        { service: 'qbittorrent', action: 'create' },
        { service: 'sonarr', action: 'create' },
      ],
    });
    expect(composes).toHaveLength(1);
  });

  it('recreates an existing guest whose host is created', async () => {
    const current = currentContainers().filter((c) => c.service !== 'gluetun');
    expect(await predictContainers(COMPOSE, VALUES, fakeRuntime(), current)).toEqual({
      ok: true,
      changes: [
        { service: 'gluetun', action: 'create' },
        { service: 'qbittorrent', action: 'recreate' },
        { service: 'sonarr', action: 'unchanged' },
      ],
    });
  });

  it('creates a missing guest without asking Compose again', async () => {
    const { runtime, composes } = recording();
    const current = currentContainers().filter((c) => c.service !== 'qbittorrent');
    expect(await predictContainers(COMPOSE, VALUES, runtime, current)).toEqual({
      ok: true,
      changes: [
        { service: 'gluetun', action: 'unchanged' },
        { service: 'qbittorrent', action: 'create' },
        { service: 'sonarr', action: 'unchanged' },
      ],
    });
    expect(composes).toHaveLength(1);
  });

  it('passes on a configuration Compose rejects', async () => {
    const runtime = fakeRuntime({
      hashes: { ok: false, error: 'services.sonarr.ports must be a list' },
    });
    expect(await predictContainers(COMPOSE, VALUES, runtime, [])).toEqual({
      ok: false,
      error: 'services.sonarr.ports must be a list',
    });
  });

  it('passes on a rejection of the guest pass', async () => {
    let calls = 0;
    const runtime: Runtime = {
      ...fakeRuntime(),
      configHashes: (compose, values) => {
        calls += 1;
        return Promise.resolve<HashesResult>(
          calls === 1
            ? { ok: true, hashes: fakeHash(compose, values) }
            : { ok: false, error: 'network_mode is invalid' },
        );
      },
    };
    expect(
      await predictContainers(COMPOSE, VALUES, runtime, currentContainers()),
    ).toEqual({ ok: false, error: 'network_mode is invalid' });
  });
});
