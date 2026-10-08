import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { isPrivateIPv4, networkOf, privateAddresses, toArch } from './facts';

function nic(
  address: string,
  cidr: string,
  extra: Partial<NetworkInterfaceInfo> = {},
): NetworkInterfaceInfo {
  return {
    address,
    cidr,
    family: 'IPv4',
    internal: false,
    netmask: '255.255.255.0',
    mac: '00:00:00:00:00:00',
    ...extra,
  } as NetworkInterfaceInfo;
}

describe('toArch', () => {
  it('maps Node architectures to image architectures', () => {
    expect(toArch('x64')).toBe('amd64');
    expect(toArch('arm64')).toBe('arm64');
    expect(toArch('ia32')).toBeUndefined();
  });
});

describe('isPrivateIPv4', () => {
  it.each([
    ['10.1.2.3', true],
    ['172.15.0.1', false],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['192.168.1.10', true],
    ['192.169.1.10', false],
    ['100.64.0.1', false],
    ['8.8.8.8', false],
  ])('%s → %s', (address, expected) => {
    expect(isPrivateIPv4(address)).toBe(expected);
  });
});

describe('networkOf', () => {
  it.each([
    ['192.168.1.10/24', '192.168.1.0/24'],
    ['10.1.2.3/8', '10.0.0.0/8'],
    ['172.20.5.9/12', '172.16.0.0/12'],
    ['10.0.0.5/32', '10.0.0.5/32'],
    ['1.2.3.4/0', '0.0.0.0/0'],
  ])('%s → %s', (cidr, expected) => {
    expect(networkOf(cidr)).toBe(expected);
  });
});

describe('privateAddresses', () => {
  it('keeps private IPv4 addresses on physical interfaces only, sorted', () => {
    expect(
      privateAddresses({
        lo: [nic('127.0.0.1', '127.0.0.1/8', { internal: true })],
        eth0: [
          nic('192.168.1.10', '192.168.1.10/24'),
          nic('fe80::1', 'fe80::1/64', { family: 'IPv6' }),
        ],
        wlan0: [nic('10.0.0.5', '10.0.0.5/24')],
        docker0: [nic('172.17.0.1', '172.17.0.1/16')],
        'br-1a2b3c': [nic('172.18.0.1', '172.18.0.1/16')],
        tailscale0: [nic('100.101.102.103', '100.101.102.103/32')],
        wg0: [nic('10.8.0.2', '10.8.0.2/24')],
        ens5: [nic('203.0.113.7', '203.0.113.7/24')],
      }),
    ).toEqual([
      { address: '10.0.0.5', cidr: '10.0.0.5/24' },
      { address: '192.168.1.10', cidr: '192.168.1.10/24' },
    ]);
  });
});
