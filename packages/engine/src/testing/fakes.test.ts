import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPOSE_PATH, ENV_PATH } from '../paths';
import { fakeDocker, fakeHash, fakeRuntime } from './fakes';

const COMPOSE = `services:
  gluetun:
    image: registry.test/gluetun:1
  qbittorrent:
    image: registry.test/qbittorrent:1
    network_mode: service:gluetun
`;

describe('fakeDocker', () => {
  it('starts what is written, hashing guests the way Compose does', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-fakes-'));
    await mkdir(join(home, 'generated'));
    await writeFile(join(home, COMPOSE_PATH), COMPOSE);
    await writeFile(join(home, ENV_PATH), "MP_X='fake-x'\n");
    const docker = fakeDocker(home);
    expect(await docker.containers()).toEqual([]);
    expect(await docker.up(600, {})).toEqual({ ok: true });
    const containers = await docker.containers();
    expect(containers.map((c) => [c.service, c.id, c.state])).toEqual([
      ['gluetun', 'fake-gluetun', 'running'],
      ['qbittorrent', 'fake-qbittorrent', 'running'],
    ]);
    const asCompose = COMPOSE.replace('service:gluetun', 'container:fake-gluetun');
    expect(containers[1]?.configHash).toBe(
      fakeHash(asCompose, { MP_X: 'fake-x' }).qbittorrent,
    );
    expect(docker.calls).toEqual(['containers', 'up', 'containers']);
  });

  it('can fail a step or leave the containers as they were', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-fakes-'));
    const failing = fakeDocker(home, {
      pull: { ok: false, error: 'fake registry down' },
    });
    expect(await failing.pull({})).toEqual({ ok: false, error: 'fake registry down' });
    const inert = fakeDocker(home, { upChangesNothing: true });
    expect(await inert.up(600, {})).toEqual({ ok: true });
    expect(await inert.containers()).toEqual([]);
  });
});

describe('fakeRuntime().hostHelper', () => {
  it('fails unless the test gives it an answer, and records the mounts', async () => {
    const calls: string[] = [];
    const mounts = [{ source: '/srv/data', target: '/mediaplane-host/0' }];
    const user = { uid: 1000, gid: 1000 };
    const none = fakeRuntime({ calls });
    expect(await none.hostHelper('mediaplane:test', '{}', mounts, user)).toEqual({
      ok: false,
      error: 'this fake Docker has no host helper',
    });
    const answering = fakeRuntime({
      calls,
      hostHelper: (request) => ({ ok: true, stdout: JSON.stringify(request) }),
    });
    const request = JSON.stringify({ facts: true, stat: [], free: [], ports: [] });
    expect(await answering.hostHelper('mediaplane:test', request, mounts, user)).toEqual({
      ok: true,
      stdout: request,
    });
    expect(calls).toEqual([
      'host-helper /mediaplane-host/0',
      'host-helper /mediaplane-host/0',
    ]);
  });
});
