import { writeFile } from 'node:fs/promises';
import type { NetworkInterfaceInfo } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectCloud,
  detectHostFacts,
  inSubnet,
  isPrivateIPv4,
  isPrivateSubnet,
  networkOf,
  privateAddresses,
  privateNetworks,
  readDmi,
  toArch,
} from './facts';
import { tempDir } from '../testing/temp';

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

describe('isPrivateSubnet', () => {
  it('accepts subnets that lie wholly inside 10/8, 172.16/12 or 192.168/16', () => {
    for (const cidr of [
      '10.0.0.0/8',
      '10.1.2.0/24',
      '172.16.0.0/12',
      '172.31.255.0/24',
      '192.168.0.0/16',
      '192.168.1.0/24',
      '192.168.1.10/32',
    ]) {
      expect(isPrivateSubnet(cidr)).toBe(true);
    }
  });

  it('refuses public subnets, and private ones that spill out of their range', () => {
    for (const cidr of [
      '0.0.0.0/0',
      '8.8.8.0/24',
      '100.64.0.0/10',
      '172.32.0.0/16',
      '172.16.0.0/11',
      '192.168.0.0/15',
      '10.0.0.0/7',
    ]) {
      expect(isPrivateSubnet(cidr)).toBe(false);
    }
  });
});

describe('privateNetworks', () => {
  it("lists each private address's network once, leaving out one wider than its range", () => {
    expect(
      privateNetworks({
        privateAddresses: [
          { address: '10.0.0.5', cidr: '10.0.0.5/4' },
          { address: '192.168.1.10', cidr: '192.168.1.10/24' },
          { address: '192.168.1.11', cidr: '192.168.1.11/24' },
        ],
      }),
    ).toEqual(['192.168.1.0/24']);
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

  it('skips VM, VPN and container-network interfaces', () => {
    expect(
      privateAddresses({
        vboxnet0: [nic('192.168.56.1', '192.168.56.1/24')],
        vmnet8: [nic('172.16.94.1', '172.16.94.1/24')],
        zt5u4b3c2d: [nic('10.147.20.5', '10.147.20.5/24')],
        cali1234abcd: [nic('10.244.0.1', '10.244.0.1/32')],
        tap0: [nic('10.10.10.1', '10.10.10.1/24')],
        nordlynx: [nic('10.5.0.2', '10.5.0.2/16')],
      }),
    ).toEqual([]);
  });
});

describe('detectCloud', () => {
  it.each([
    [
      {
        sys_vendor: 'QEMU',
        product_name: 'KVM Virtual Machine',
        chassis_asset_tag: 'OracleCloud.com',
      },
      'Oracle Cloud',
    ],
    [{ sys_vendor: 'Amazon EC2', product_name: 't3.micro' }, 'Amazon Web Services'],
    [{ sys_vendor: 'Xen', product_version: '4.11.amazon' }, 'Amazon Web Services'],
    [{ sys_vendor: 'Google', product_name: 'Google Compute Engine' }, 'Google Cloud'],
    [
      {
        sys_vendor: 'Microsoft Corporation',
        product_name: 'Virtual Machine',
        chassis_asset_tag: '7783-7084-3265-9085-8269-3286-77',
      },
      'Microsoft Azure',
    ],
    [{ sys_vendor: 'Hetzner', product_name: 'vServer' }, 'Hetzner Cloud'],
    [{ sys_vendor: 'DigitalOcean', product_name: 'Droplet' }, 'DigitalOcean'],
  ])('%o is %s', (dmi, name) => {
    expect(detectCloud(dmi)).toBe(name);
  });

  it.each([
    [{}],
    [{ sys_vendor: 'QEMU', product_name: 'Standard PC (Q35 + ICH9, 2009)' }],
    [
      {
        sys_vendor: 'Microsoft Corporation',
        product_name: 'Virtual Machine',
        chassis_asset_tag: '0000-0000-0000',
      },
    ],
    [{ sys_vendor: 'Dell Inc.', product_name: 'OptiPlex 7070' }],
  ])('%o is not a cloud', (dmi) => {
    expect(detectCloud(dmi)).toBeUndefined();
  });
});

describe('readDmi', () => {
  it('reads the identifying fields and skips missing or empty ones', async () => {
    const dir = await tempDir('mediaplane-dmi-');
    await writeFile(join(dir, 'sys_vendor'), 'QEMU\n');
    await writeFile(join(dir, 'chassis_asset_tag'), 'OracleCloud.com\n');
    await writeFile(join(dir, 'product_name'), '\n');
    expect(readDmi(dir)).toEqual({
      sys_vendor: 'QEMU',
      chassis_asset_tag: 'OracleCloud.com',
    });
  });

  it('returns nothing for a directory that does not exist', () => {
    expect(readDmi('/nonexistent/mediaplane/dmi')).toEqual({});
  });
});

describe('inSubnet', () => {
  it.each([
    ['192.168.1.10', '192.168.1.0/24', true],
    ['192.168.2.10', '192.168.1.0/24', false],
    ['10.0.0.208', '10.0.0.0/8', true],
    ['10.0.0.208', '10.0.0.0/32', false],
  ])('%s in %s is %s', (address, cidr, expected) => {
    expect(inSubnet(address, cidr)).toBe(expected);
  });
});

describe('detectHostFacts', () => {
  it('reports the cloud named by the firmware', async () => {
    const dir = await tempDir('mediaplane-dmi-');
    await writeFile(join(dir, 'chassis_asset_tag'), 'OracleCloud.com\n');
    expect(detectHostFacts(dir).cloud).toBe('Oracle Cloud');
  });

  it('reports no cloud when the firmware is not a known cloud', async () => {
    const dir = await tempDir('mediaplane-dmi-');
    await writeFile(join(dir, 'sys_vendor'), 'QEMU\n');
    expect(detectHostFacts(dir)).not.toHaveProperty('cloud');
  });
});
