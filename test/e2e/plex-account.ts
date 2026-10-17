import { appendFile, readFile } from 'node:fs/promises';

/**
 * The plex.tv test account of the nightly Plex job: its token, in the file that
 * MEDIAPLANE_E2E_PLEX_TOKEN_FILE names (never on a command line, never printed), and a
 * file, MEDIAPLANE_E2E_PLEX_SERVERS, where the job notes each server it claims as soon as
 * it knows it, so that a step after a failed run can still remove them.
 */
export const PLEX_TOKEN_FILE = process.env.MEDIAPLANE_E2E_PLEX_TOKEN_FILE;
const SERVERS_FILE = process.env.MEDIAPLANE_E2E_PLEX_SERVERS;

/** The test account's token, from PLEX_TOKEN_FILE. */
export async function plexToken(): Promise<string> {
  if (PLEX_TOKEN_FILE === undefined) {
    throw new Error('MEDIAPLANE_E2E_PLEX_TOKEN_FILE is not set');
  }
  const token = (await readFile(PLEX_TOKEN_FILE, 'utf8')).trim();
  if (token === '') throw new Error('MEDIAPLANE_E2E_PLEX_TOKEN_FILE holds no token');
  return token;
}

/**
 * Have GitHub Actions hide `value` in the job's log from now on, as it hides the secret
 * itself, which it does not do for a value made from it: a claim token, a server's token.
 * Outside Actions, nothing.
 */
export function mask(value: string): void {
  if (process.env.GITHUB_ACTIONS === 'true' && value !== '') {
    process.stdout.write(`::add-mask::${value}\n`);
  }
}

/**
 * Note a server the run claimed, by its machine identifier, for the cleanup: once, however
 * often it is noted, so that the cleanup's counts are of servers.
 */
export async function noteServer(machineId: string): Promise<void> {
  if (SERVERS_FILE === undefined || (await notedServers()).includes(machineId)) return;
  await appendFile(SERVERS_FILE, `${machineId}\n`);
}

/** The servers noted so far, each once. */
export async function notedServers(): Promise<string[]> {
  if (SERVERS_FILE === undefined) return [];
  try {
    const lines = (await readFile(SERVERS_FILE, 'utf8')).split('\n');
    return [...new Set(lines.filter((id) => id !== ''))];
  } catch {
    return [];
  }
}

const HEADERS = {
  Accept: 'application/json',
  'X-Plex-Product': 'Mediaplane',
  'X-Plex-Client-Identifier': 'mediaplane-e2e',
};

/** A device on the account, as plex.tv's `GET /api/v2/devices` lists it. */
export interface Device {
  id: number;
  clientIdentifier: string;
  provides?: string | null;
}

/** Whether `device` is a server, as plex.tv lists it. */
function isServer(device: Device): boolean {
  return (device.provides ?? '').split(',').includes('server');
}

/**
 * The devices of `devices` to remove: the servers whose machine identifiers are
 * `machineIds`, which this run noted, and never another device, server or not.
 */
export function serversToRemove<D extends Device>(
  devices: readonly D[],
  machineIds: readonly string[],
): D[] {
  return devices.filter(
    (device) => isServer(device) && machineIds.includes(device.clientIdentifier),
  );
}

/**
 * Hide every value plex.tv gives under a field whose name says token, at any depth: a
 * device's `token` (probed: the only one its answer has), and any it may add.
 */
function maskTokens(value: unknown, field = ''): void {
  if (Array.isArray(value)) {
    for (const item of value) maskTokens(item, field);
  } else if (value !== null && typeof value === 'object') {
    for (const [name, inner] of Object.entries(value)) maskTokens(inner, name);
  } else if (typeof value === 'string' && /token/i.test(field)) {
    mask(value);
  }
}

/**
 * Remove from the account the servers whose machine identifiers are `machineIds`, as
 * plex.tv's own web app does (probed): find each in the account's devices, then
 * `DELETE /devices/<id>.xml`. Removed already is fine. The machine identifiers removed,
 * those the account didn't list, and how many other servers it has, left alone. A
 * refusal, or an answer that isn't JSON, throws with its status (and length) only.
 */
export async function removeServers(
  token: string,
  machineIds: readonly string[],
): Promise<{ removed: string[]; absent: string[]; others: number }> {
  if (machineIds.length === 0) return { removed: [], absent: [], others: 0 };
  const listed = await fetch('https://plex.tv/api/v2/devices', {
    headers: { ...HEADERS, 'X-Plex-Token': token },
    signal: AbortSignal.timeout(30_000),
  });
  if (!listed.ok) {
    throw new Error(`plex.tv listed no devices: status ${String(listed.status)}`);
  }
  // Parsed here, from its text: JSON.parse's own error, or .json()'s, quotes the body.
  const body = await listed.text();
  let devices: Device[];
  try {
    devices = JSON.parse(body) as Device[];
  } catch {
    throw new Error(
      `plex.tv listed its devices with ${String(body.length)} characters that aren't JSON (status ${String(listed.status)})`,
    );
  }
  maskTokens(devices);
  const ours = serversToRemove(devices, machineIds);
  const removed: string[] = [];
  for (const device of ours) {
    const gone = await fetch(`https://plex.tv/devices/${String(device.id)}.xml`, {
      method: 'DELETE',
      headers: { ...HEADERS, 'X-Plex-Token': token },
      signal: AbortSignal.timeout(30_000),
    });
    if (!gone.ok && gone.status !== 404) {
      throw new Error(`plex.tv kept a server: status ${String(gone.status)}`);
    }
    removed.push(device.clientIdentifier);
  }
  return {
    removed,
    absent: machineIds.filter((id) => !removed.includes(id)),
    others: devices.filter(isServer).length - ours.length,
  };
}
