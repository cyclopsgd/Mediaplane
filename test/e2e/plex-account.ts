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

/** Note a server the run claimed, by its machine identifier, for the cleanup. */
export async function noteServer(machineId: string): Promise<void> {
  if (SERVERS_FILE !== undefined) await appendFile(SERVERS_FILE, `${machineId}\n`);
}

/** The servers noted so far. */
export async function notedServers(): Promise<string[]> {
  if (SERVERS_FILE === undefined) return [];
  try {
    return (await readFile(SERVERS_FILE, 'utf8')).split('\n').filter((id) => id !== '');
  } catch {
    return [];
  }
}

const HEADERS = {
  Accept: 'application/json',
  'X-Plex-Product': 'Mediaplane',
  'X-Plex-Client-Identifier': 'mediaplane-e2e',
};

/**
 * Remove from the account the servers whose machine identifiers are `machineIds`, as
 * plex.tv's own web app does (probed): find each in the account's devices, then
 * `DELETE /devices/<id>.xml`. Removed already is fine. The machine identifiers removed,
 * and those the account didn't list; a refusal throws, with its status only.
 */
export async function removeServers(
  token: string,
  machineIds: readonly string[],
): Promise<{ removed: string[]; absent: string[] }> {
  if (machineIds.length === 0) return { removed: [], absent: [] };
  const listed = await fetch('https://plex.tv/api/v2/devices', {
    headers: { ...HEADERS, 'X-Plex-Token': token },
    signal: AbortSignal.timeout(30_000),
  });
  if (!listed.ok) {
    throw new Error(`plex.tv listed no devices: status ${String(listed.status)}`);
  }
  const devices = (await listed.json()) as {
    id: number;
    clientIdentifier: string;
    provides?: string | null;
    token?: string;
  }[];
  for (const device of devices) mask(device.token ?? '');
  const removed: string[] = [];
  for (const device of devices) {
    const server = (device.provides ?? '').split(',').includes('server');
    if (!server || !machineIds.includes(device.clientIdentifier)) continue;
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
  return { removed, absent: machineIds.filter((id) => !removed.includes(id)) };
}
