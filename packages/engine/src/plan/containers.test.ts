import { describe, expect, it } from 'vitest';
import type { ContainerState } from '../runtime/types';
import { ownPorts, planContainers } from './containers';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function container(service: string, extra: Partial<ContainerState> = {}): ContainerState {
  return {
    service,
    id: `id-${service}`,
    state: 'running',
    health: '',
    configHash: HASH_A,
    published: [],
    ...extra,
  };
}

describe('planContainers', () => {
  it('creates, recreates, starts, keeps and removes', () => {
    const changes = planContainers(
      { jellyfin: HASH_A, radarr: HASH_B, sonarr: HASH_A, prowlarr: HASH_A },
      [
        container('radarr'),
        container('sonarr'),
        container('prowlarr', { state: 'exited' }),
        container('bazarr'),
      ],
    );
    expect(changes).toEqual([
      { service: 'jellyfin', action: 'create' },
      { service: 'prowlarr', action: 'start' },
      { service: 'radarr', action: 'recreate' },
      { service: 'sonarr', action: 'unchanged' },
      { service: 'bazarr', action: 'remove' },
    ]);
  });

  it('recreates a running container whose hash Compose did not record', () => {
    expect(
      planContainers({ sonarr: HASH_A }, [
        container('sonarr', { configHash: undefined }),
      ]),
    ).toEqual([{ service: 'sonarr', action: 'recreate' }]);
  });

  it('recreates a service if any of its several containers is stale', () => {
    expect(
      planContainers({ sonarr: HASH_A }, [
        container('sonarr'),
        container('sonarr', { id: 'id-sonarr-2', configHash: HASH_B }),
      ]),
    ).toEqual([{ service: 'sonarr', action: 'recreate' }]);
  });

  it('starts a service if any of its current containers is stopped', () => {
    expect(
      planContainers({ sonarr: HASH_A }, [
        container('sonarr'),
        container('sonarr', { id: 'id-sonarr-2', state: 'exited' }),
      ]),
    ).toEqual([{ service: 'sonarr', action: 'start' }]);
  });

  it('judges several containers whatever order Docker lists them in', () => {
    expect(
      planContainers({ sonarr: HASH_A }, [
        container('sonarr', { id: 'id-sonarr-2', configHash: HASH_B }),
        container('sonarr'),
      ]),
    ).toEqual([{ service: 'sonarr', action: 'recreate' }]);
    expect(
      planContainers({ sonarr: HASH_A }, [
        container('sonarr', { id: 'id-sonarr-2', state: 'exited' }),
        container('sonarr'),
      ]),
    ).toEqual([{ service: 'sonarr', action: 'start' }]);
  });

  it('keeps a service whose containers are all current and running', () => {
    expect(
      planContainers({ sonarr: HASH_A }, [
        container('sonarr'),
        container('sonarr', { id: 'id-sonarr-2' }),
      ]),
    ).toEqual([{ service: 'sonarr', action: 'unchanged' }]);
  });
});

describe('ownPorts', () => {
  it('collects every published port, whatever the address', () => {
    const ports = ownPorts([
      container('sonarr', {
        published: [{ address: '127.0.0.1', port: 8989, protocol: 'tcp' }],
      }),
      container('plex', {
        published: [
          { address: '0.0.0.0', port: 32400, protocol: 'tcp' },
          { address: '192.168.1.10', port: 32400, protocol: 'tcp' },
        ],
      }),
    ]);
    expect([...ports].sort()).toEqual(['tcp/32400', 'tcp/8989']);
  });
});
