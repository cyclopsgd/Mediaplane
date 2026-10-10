import { readFileSync } from 'node:fs';
import { arch, networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { join } from 'node:path';
import type { Arch } from '../catalog/types';
import { compare } from '../util/sort';

export interface HostFacts {
  arch: Arch;
  /** Private (RFC 1918) IPv4 addresses on physical interfaces, sorted. */
  privateAddresses: { address: string; cidr: string }[];
  /** The public cloud this VM runs on, when its firmware says so (e.g. "Oracle Cloud"). */
  cloud?: string;
}

/** Interfaces created by container, VM and VPN software. Never "the LAN". */
const VIRTUAL_INTERFACE_PREFIXES = [
  'docker',
  'br-',
  'veth',
  'virbr',
  'cni',
  'flannel',
  'podman',
  'lxc',
  'lxd',
  'tailscale',
  'wg',
  'tun',
  'tap',
  'vmnet',
  'vboxnet',
  'zt',
  'ppp',
  'nordlynx',
  'cali',
  'kube-',
  'weave',
  'cilium',
  'utun',
  'vxlan',
];

export function toArch(nodeArch: string): Arch | undefined {
  if (nodeArch === 'x64') return 'amd64';
  if (nodeArch === 'arm64') return 'arm64';
  return undefined;
}

export function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number);
  if (a === 10) return true;
  if (a === 172) return b !== undefined && b >= 16 && b <= 31;
  return a === 192 && b === 168;
}

/** "192.168.1.10/24" → "192.168.1.0/24". */
export function networkOf(cidr: string): string {
  const [address = '', prefixText = '32'] = cidr.split('/');
  const prefix = Number(prefixText);
  const value = address
    .split('.')
    .reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (value & mask) >>> 0;
  const octets = [24, 16, 8, 0].map((shift) => (network >>> shift) & 255);
  return `${octets.join('.')}/${prefix}`;
}

/** Whether `address` lies inside `cidr`. */
export function inSubnet(address: string, cidr: string): boolean {
  const prefix = cidr.split('/')[1] ?? '32';
  return networkOf(`${address}/${prefix}`) === networkOf(cidr);
}

/** The RFC 1918 ranges, with their prefix lengths. */
const PRIVATE_RANGES = [
  ['10.0.0.0/8', 8],
  ['172.16.0.0/12', 12],
  ['192.168.0.0/16', 16],
] as const;

/** Whether all of `cidr` lies inside one RFC 1918 range. */
export function isPrivateSubnet(cidr: string): boolean {
  const [address = '', prefix = '32'] = cidr.split('/');
  return PRIVATE_RANGES.some(
    ([range, size]) => Number(prefix) >= size && inSubnet(address, range),
  );
}

export type DmiField =
  'sys_vendor' | 'product_name' | 'product_version' | 'bios_vendor' | 'chassis_asset_tag';
export type DmiInfo = Partial<Record<DmiField, string>>;

const DMI_FIELDS: readonly DmiField[] = [
  'sys_vendor',
  'product_name',
  'product_version',
  'bios_vendor',
  'chassis_asset_tag',
];

/** Firmware strings public clouds put in their VMs (the ones cloud-init's ds-identify uses). */
const CLOUD_SIGNATURES: readonly { name: string; matches: (dmi: DmiInfo) => boolean }[] =
  [
    {
      name: 'Amazon Web Services',
      matches: (d) =>
        d.sys_vendor === 'Amazon EC2' ||
        d.bios_vendor === 'Amazon EC2' ||
        /amazon/i.test(d.product_version ?? ''),
    },
    {
      name: 'Microsoft Azure',
      matches: (d) => d.chassis_asset_tag === '7783-7084-3265-9085-8269-3286-77',
    },
    {
      name: 'Google Cloud',
      matches: (d) =>
        d.product_name === 'Google Compute Engine' || d.sys_vendor === 'Google',
    },
    { name: 'Oracle Cloud', matches: (d) => d.chassis_asset_tag === 'OracleCloud.com' },
    { name: 'Alibaba Cloud', matches: (d) => d.product_name === 'Alibaba Cloud ECS' },
    { name: 'DigitalOcean', matches: (d) => d.sys_vendor === 'DigitalOcean' },
    { name: 'Hetzner Cloud', matches: (d) => d.sys_vendor === 'Hetzner' },
    { name: 'Scaleway', matches: (d) => d.sys_vendor === 'Scaleway' },
    { name: 'Vultr', matches: (d) => d.sys_vendor === 'Vultr' },
    {
      name: 'Akamai (Linode)',
      matches: (d) => d.sys_vendor === 'Linode' || d.sys_vendor === 'Akamai',
    },
    { name: 'UpCloud', matches: (d) => d.sys_vendor === 'UpCloud' },
    { name: 'Exoscale', matches: (d) => d.product_name === 'Exoscale' },
    {
      name: 'OpenStack',
      matches: (d) => /^OpenStack (Nova|Compute)$/.test(d.product_name ?? ''),
    },
  ];

/** The public cloud these firmware strings belong to, if any. */
export function detectCloud(dmi: DmiInfo): string | undefined {
  return CLOUD_SIGNATURES.find((signature) => signature.matches(dmi))?.name;
}

/** The identifying DMI fields; unreadable or empty ones are left out. */
export function readDmi(dir = '/sys/class/dmi/id'): DmiInfo {
  const dmi: DmiInfo = {};
  for (const field of DMI_FIELDS) {
    try {
      const value = readFileSync(join(dir, field), 'utf8').trim();
      if (value !== '') dmi[field] = value;
    } catch {
      // Absent or unreadable (not Linux, or a restricted container): unknown.
    }
  }
  return dmi;
}

export function privateAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): HostFacts['privateAddresses'] {
  const found: HostFacts['privateAddresses'] = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    if (VIRTUAL_INTERFACE_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    for (const info of infos ?? []) {
      if (
        info.family === 'IPv4' &&
        !info.internal &&
        info.cidr !== null &&
        isPrivateIPv4(info.address)
      ) {
        found.push({ address: info.address, cidr: info.cidr });
      }
    }
  }
  return found.sort((x, y) => compare(x.address, y.address));
}

/** Facts about the machine this process runs on. (S2c adds in-container detection.) */
export function detectHostFacts(dmiDir?: string): HostFacts {
  const hostArch = toArch(arch());
  if (hostArch === undefined) {
    throw new Error(
      `unsupported CPU architecture "${arch()}": Mediaplane supports amd64 and arm64`,
    );
  }
  const cloud = detectCloud(readDmi(dmiDir));
  return {
    arch: hostArch,
    privateAddresses: privateAddresses(networkInterfaces()),
    ...(cloud === undefined ? {} : { cloud }),
  };
}
