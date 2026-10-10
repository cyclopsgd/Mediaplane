import { describe, expect, it } from 'vitest';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import type { ContainerState } from '../runtime/types';
import { fakeContainer, fakeRuntime } from '../testing/fakes';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import type { ContainerAction, ContainerChange } from './containers';
import { startedBefore, strandedGuests } from './stranded';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  qbittorrent: {}
`;

function stack(): ResolvedStack {
  const result = resolveStack(fixtureConfig(STACK), fixtureCatalog, FIXTURE_HOST, '/opt');
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

const GLUETUN = fakeContainer('gluetun', 'id-gluetun');
const QBITTORRENT = fakeContainer('qbittorrent', 'id-qbittorrent');
const changes = (gluetun: ContainerAction, qbittorrent: ContainerAction = 'unchanged') =>
  [
    { service: 'gluetun', action: gluetun },
    { service: 'jellyfin', action: 'unchanged' },
    { service: 'qbittorrent', action: qbittorrent },
  ] satisfies ContainerChange[];
const EARLY = '2026-10-10T10:00:00Z';
const LATE = '2026-10-10T11:00:00Z';

function runtimeWith(
  started: { qbittorrent: string; gluetun: string },
  calls: string[] = [],
) {
  return fakeRuntime({
    calls,
    details: {
      'id-qbittorrent': { startedAt: started.qbittorrent },
      'id-gluetun': { startedAt: started.gluetun },
    },
  });
}

describe('startedBefore', () => {
  it('compares the two start times, and knows nothing of one it cannot read', () => {
    const at = (startedAt: string) => ({ id: 'x', networkMode: 'bridge', startedAt });
    expect(startedBefore(at(EARLY), at(LATE))).toBe(true);
    expect(startedBefore(at(LATE), at(EARLY))).toBe(false);
    expect(startedBefore(at(EARLY), at(EARLY))).toBe(false);
    expect(startedBefore(at('0001-01-01T00:00:00Z'), at('not a time'))).toBeUndefined();
    expect(startedBefore(undefined, at(EARLY))).toBeUndefined();
  });
});

describe('strandedGuests', () => {
  const current: ContainerState[] = [GLUETUN, QBITTORRENT];

  it('restarts a running guest whose stopped host apply starts again', async () => {
    const stopped = [{ ...GLUETUN, state: 'exited' }, QBITTORRENT];
    const calls: string[] = [];
    const runtime = runtimeWith({ qbittorrent: LATE, gluetun: EARLY }, calls);
    expect(await strandedGuests(stack(), stopped, changes('start'), runtime)).toEqual([
      'qbittorrent',
    ]);
    // Nothing to compare: its host's next start is the one that matters.
    expect(calls.filter((call) => call.startsWith('inspect'))).toEqual([]);
  });

  it('restarts a guest that started before its host last did', async () => {
    const runtime = runtimeWith({ qbittorrent: EARLY, gluetun: LATE });
    expect(await strandedGuests(stack(), current, changes('unchanged'), runtime)).toEqual(
      ['qbittorrent'],
    );
  });

  it('leaves a guest that started after its host, or that apply changes anyway', async () => {
    const after = runtimeWith({ qbittorrent: LATE, gluetun: EARLY });
    expect(await strandedGuests(stack(), current, changes('unchanged'), after)).toEqual(
      [],
    );
    const before = runtimeWith({ qbittorrent: EARLY, gluetun: LATE });
    // A recreated host recreates its guest too (its hash changes), and Compose restarts
    // a guest whose host it recreates; a guest that up starts or recreates joins anew.
    for (const [gluetun, qbittorrent] of [
      ['recreate', 'recreate'],
      ['unchanged', 'start'],
      ['start', 'recreate'],
    ] as const) {
      expect(
        await strandedGuests(stack(), current, changes(gluetun, qbittorrent), before),
      ).toEqual([]);
    }
  });

  it('leaves a guest that is not running', async () => {
    const runtime = runtimeWith({ qbittorrent: EARLY, gluetun: LATE });
    const exited = [GLUETUN, { ...QBITTORRENT, state: 'exited' }];
    expect(await strandedGuests(stack(), exited, changes('start'), runtime)).toEqual([]);
  });
});
