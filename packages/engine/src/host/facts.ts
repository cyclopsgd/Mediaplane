import { arch, networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import type { Arch } from '../catalog/types';
import { compare } from '../util/sort';

export interface HostFacts {
  arch: Arch;
  /** Private (RFC 1918) IPv4 addresses on physical interfaces, sorted. */
  privateAddresses: { address: string; cidr: string }[];
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

/** Facts about the machine this process runs on. (S2 adds container-aware detection.) */
export function detectHostFacts(): HostFacts {
  const hostArch = toArch(arch());
  if (hostArch === undefined) {
    throw new Error(
      `unsupported CPU architecture "${arch()}": Mediaplane supports amd64 and arm64`,
    );
  }
  return { arch: hostArch, privateAddresses: privateAddresses(networkInterfaces()) };
}
