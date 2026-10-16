import { describe, expect, it } from 'vitest';
import { wiringStack } from '../testing/wiring';
import { fixtureCatalog } from '../testing/fixtures';
import { serviceAddress, serviceOf, stackAddress } from './address';

const STACK = (qbittorrent: string) => `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: { port: 8990 }
  qbittorrent: ${qbittorrent}
`;

function appOf(id: string, qbittorrent = '{}') {
  return wiringStack(fixtureCatalog, STACK(qbittorrent)).apps.find(
    (a) => a.def.id === id,
  );
}

describe('serviceAddress', () => {
  it("gives an app's service and container port, whatever port the host publishes", () => {
    const sonarr = appOf('sonarr');
    expect(sonarr === undefined ? undefined : serviceOf(sonarr)).toBe('sonarr');
    expect(serviceAddress(sonarr, 'web')).toEqual({ host: 'sonarr', port: 8989 });
  });

  it("puts the app whose network namespace an app runs in at that app's service", () => {
    expect(serviceAddress(appOf('qbittorrent'), 'web')).toEqual({
      host: 'gluetun',
      port: 8080,
    });
    expect(
      serviceAddress(appOf('qbittorrent', '{ vpn: false, port: 8090 }'), 'web'),
    ).toEqual({ host: 'qbittorrent', port: 8090 });
  });

  it('gives nothing for an app the stack lacks, or a port it has none of', () => {
    expect(serviceAddress(undefined, 'web')).toBeUndefined();
    expect(serviceAddress(appOf('sonarr'), 'api')).toBeUndefined();
  });
});

describe('stackAddress', () => {
  it("finds the stack's app by its id, and gives nothing for one the stack lacks", () => {
    const stack = wiringStack(fixtureCatalog, STACK('{}'));
    expect(stackAddress(stack, 'sonarr')).toEqual({ host: 'sonarr', port: 8989 });
    expect(stackAddress(stack, 'qbittorrent', 'web')).toEqual({
      host: 'gluetun',
      port: 8080,
    });
    expect(stackAddress(stack, 'radarr')).toBeUndefined();
    expect(stackAddress(stack, 'sonarr', 'api')).toBeUndefined();
  });
});
