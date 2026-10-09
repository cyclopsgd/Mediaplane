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
});

describe('ownPorts', () => {
  it('collects every published address as a port key', () => {
    const ports = ownPorts([
      container('sonarr', {
        published: [{ address: '127.0.0.1', port: 8989, protocol: 'tcp' }],
      }),
      container('plex', {
        published: [{ address: '0.0.0.0', port: 32400, protocol: 'tcp' }],
      }),
    ]);
    expect([...ports].sort()).toEqual(['tcp/0.0.0.0:32400', 'tcp/127.0.0.1:8989']);
  });
});
