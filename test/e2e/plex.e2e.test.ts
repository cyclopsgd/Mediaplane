import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  createDockerRuntime,
  detectHostFacts,
  nodeExec,
  nodeProbe,
  plan,
  plexTvClient,
  readSecretStore,
  type ApplyOptions,
  type ApplyResult,
  type PlexTv,
  type Runtime,
} from '@mediaplane/engine';
import { FAKE_PLEX_ACCOUNT, fakePlexTv } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import {
  api,
  composeDown,
  expectWiringRemoved,
  getJson,
  jsonBody,
  makeHome,
  runTeardown,
  servarrFailure,
  wired,
} from './helpers';
import {
  mask,
  noteServer,
  notedServers,
  PLEX_TOKEN_FILE,
  plexToken,
  removeServers,
  serversToRemove,
} from './plex-account';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-plex`;
/** Plex's web UI, on 127.0.0.1 once it is published. */
const PLEX = 32400;
/** Seerr's, once it is published. */
const SEERR = 5055;
/** Where Plex keeps its claim's token, in its appdata folder. */
const PREFERENCES =
  'appdata/plex/Library/Application Support/Plex Media Server/Preferences.xml';

/** A Plex stack in `home`: Plex named for this run, Sonarr, qBittorrent, and `more`. */
function plexStack(home: string, more = ''): string {
  return `version: 1
user: { uid: ${String(process.getuid?.() ?? 1000)}, gid: ${String(process.getgid?.() ?? 1000)} }
paths: { data: ${join(home, 'data')} }
network: { bind: localhost }
media_server: plex
plex: { token: { file: secrets/plex-token } }
apps:
  plex: { server_name: ${PROJECT} }
  sonarr: {}
  qbittorrent: { vpn: false }
${more}`;
}

/** Your token, saved where plex.token says, as plex-login saves it. */
async function saveToken(home: string, token: string): Promise<void> {
  await mkdir(join(home, 'secrets'), { recursive: true, mode: 0o700 });
  await writeFile(join(home, 'secrets', 'plex-token'), `${token}\n`, { mode: 0o600 });
}

/**
 * Plex's container now: whether its port is published, whether a PLEX_CLAIM with a value
 * is in its environment (yes or no, never its value; an empty one is none), and whether
 * it says it is claimed, asked at its address on the wiring network (from source, the
 * host reaches it there).
 */
async function plexState(runtime: Runtime): Promise<string> {
  const container = (await runtime.containers()).find((c) => c.service === 'plex');
  if (container === undefined) return 'no container';
  const env = await nodeExec(
    'docker',
    ['inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', container.id],
    { cwd: '/' },
  );
  const claim = env.stdout
    .split('\n')
    .some((line) => line.startsWith('PLEX_CLAIM=') && line !== 'PLEX_CLAIM=');
  const address = (await runtime.wiringAddresses([container.id]))[container.id] ?? '';
  const answer = await fetch(`http://${address}:${String(PLEX)}/identity`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  const { MediaContainer } = await jsonBody<{ MediaContainer?: { claimed?: unknown } }>(
    answer,
    "Plex's identity",
  );
  const shown = container.published
    .map((p) => `${p.address}:${String(p.port)}`)
    .join(' ');
  return `ports ${shown === '' ? 'none' : shown}, claim ${claim ? 'given' : 'none'}, ${MediaContainer?.claimed === true ? 'claimed' : 'unclaimed'}`;
}

/** That none of `secrets` is in `text`: a yes/no check, which never prints either. */
function expectNoSecret(what: string, text: string, secrets: readonly string[]): void {
  for (const secret of secrets.filter((s) => s !== '')) {
    expect(text.includes(secret), `${what} holds a secret`).toBe(false);
  }
}

/**
 * What the run wrote: compose.yaml, resources.json and the change records, where no
 * secret may go; or with `env`, generated/.env too, which holds the stack's own keys but
 * never one of Plex's.
 */
async function writtenFiles(home: string, { env = false } = {}): Promise<string> {
  const files = [
    'generated/compose.yaml',
    ...(env ? ['generated/.env'] : []),
    'state/resources.json',
    ...(await readdir(join(home, 'state', 'history'))).map((n) => `state/history/${n}`),
  ];
  const texts = await Promise.all(
    files.map((file) => readFile(join(home, file), 'utf8').catch(() => '')),
  );
  return texts.join('\n');
}

describe('Plex that a claim token from plex.tv can not claim', () => {
  it('is never published, is given its claim token only on its unpublished first start, and the rest waits', async () => {
    const home = await makeHome();
    const removeAll = () =>
      runTeardown([
        async () => {
          const down = await composeDown(PROJECT);
          expect(down.code, down.stderr).toBe(0);
        },
        () => expectWiringRemoved(PROJECT),
      ]);
    try {
      await writeFile(join(home, 'stack.yaml'), plexStack(home));
      // Every PR runs without a plex.tv account: a fake plex.tv hands out a claim token
      // that the real plex.tv, which Plex's image trades it at, doesn't know. Its server
      // is closed as this test finishes, passed or failed (fakeHttpApp's onTestFinished).
      const fake = await fakePlexTv();
      await saveToken(home, FAKE_PLEX_ACCOUNT.token);
      const docker = createDockerRuntime({ home, project: PROJECT });
      const seen: string[] = [];
      const runtime: Runtime = {
        ...docker,
        up: async (seconds, values, unpublished = [], startEnv = {}) => {
          const result = await docker.up(seconds, values, unpublished, startEnv);
          seen.push(`after an up: ${await plexState(docker)}`);
          return result;
        },
      };
      const options: ApplyOptions = {
        home,
        catalog,
        host: detectHostFacts(),
        env: process.env,
        runtime,
        probe: nodeProbe,
        project: PROJECT,
        plexTv: fake.client,
        confirm: () => Promise.resolve(true),
      };

      // plan names Plex's setup, unpublished, and asks plex.tv nothing.
      expect((await plan(options)).bootstrap).toEqual([
        { app: 'plex', unpublished: true },
      ]);
      expect(fake.state.calls).toEqual([]);

      const first = await apply(options);
      expect(first.outcome).toBe('failed');
      expect(fake.state.claims.map((c) => c.account)).toEqual([FAKE_PLEX_ACCOUNT.id]);
      // Unpublished from its first start, and again in the publishing up: its setup is
      // still open, and its container keeps its claim token, so it isn't recreated.
      expect(seen).toEqual([
        'after an up: ports none, claim given, unclaimed',
        'after an up: ports none, claim given, unclaimed',
      ]);
      const failed = first.diagnostics.find((d) => d.code === 'apply.bootstrap-failed');
      expect(failed?.message).toContain(
        "didn't claim itself as it started, so it stays unpublished",
      );
      expect(first.actions.find((a) => a.step === 'wire')?.result).toBe('skipped');
      // The claim token is in Compose's environment only: no file, record or result.
      const claim = fake.state.claims[0]?.token ?? '';
      expectNoSecret('what apply wrote', await writtenFiles(home, { env: true }), [
        claim,
        FAKE_PLEX_ACCOUNT.token,
      ]);
      expectNoSecret("apply's result", JSON.stringify(first), [
        claim,
        FAKE_PLEX_ACCOUNT.token,
      ]);
      expect((await readSecretStore(home)).setUp).toBeUndefined();
    } catch (failure) {
      await removeAll().catch((also: unknown) => {
        console.error('teardown failed too:', also);
      });
      throw failure;
    }
    await removeAll();
  }, 900_000);
});

/**
 * What Plex's Preferences.xml in `home` holds: its machine identifier, and its own token,
 * once its claim gave it one; '' for either it doesn't hold yet.
 */
async function preferencesIn(
  home: string,
): Promise<{ machineId: string; serverToken: string }> {
  const prefs = await readFile(join(home, PREFERENCES), 'utf8').catch(() => '');
  return {
    machineId: /\sProcessedMachineIdentifier="([^"]+)"/.exec(prefs)?.[1] ?? '',
    serverToken: /\sPlexOnlineToken="([^"]+)"/.exec(prefs)?.[1] ?? '',
  };
}

/**
 * `client`, hiding each claim token it gets, which it keeps in `claims`, and, each time
 * it is asked whose a token is, as Plex's setup asks once Plex is claimed, noting Plex's
 * server in `home` for the cleanup and hiding Plex's own token.
 */
function noting(client: PlexTv, claims: string[], home: string): PlexTv {
  return {
    ...client,
    claimToken: async (token) => {
      const claim = await client.claimToken(token);
      mask(claim);
      claims.push(claim);
      return claim;
    },
    accountId: async (token) => {
      const { machineId, serverToken } = await preferencesIn(home);
      mask(serverToken);
      if (machineId !== '') await noteServer(machineId);
      return client.accountId(token);
    },
  };
}

/**
 * `runtime`, noting Plex's server in `home` for the cleanup as soon as it is known, in the
 * `up` that starts Plex with its claim token: while that `up` runs, and for up to 30
 * seconds after, as soon as Plex's Preferences.xml names its machine identifier, which
 * Plex writes as it first starts, before it is claimed. So the cleanup knows the server
 * even when the run is cancelled before Plex's setup asks plex.tv whose Plex is.
 * `noted.atStart` says whether it was noted so.
 */
function notingAtStart(
  runtime: Runtime,
  home: string,
  noted: { atStart: boolean },
): Runtime {
  return {
    ...runtime,
    up: async (seconds, values, unpublished = [], startEnv = {}) => {
      if (startEnv.plex === undefined) {
        return runtime.up(seconds, values, unpublished, startEnv);
      }
      let until = Number.POSITIVE_INFINITY;
      const watch = (async () => {
        while (Date.now() < until) {
          const { machineId } = await preferencesIn(home);
          if (machineId !== '') {
            await noteServer(machineId);
            noted.atStart = true;
            return;
          }
          await new Promise((wait) => setTimeout(wait, 1000));
        }
      })();
      try {
        return await runtime.up(seconds, values, unpublished, startEnv);
      } finally {
        until = Date.now() + 30_000;
        await watch;
      }
    },
  };
}

interface Connection {
  id: number;
  name: string;
  implementation: string;
  fields: { name: string; value?: unknown }[];
}

interface Section {
  title: string;
  type: string;
  Location?: { path: string }[];
}

describe("the nightly job's cleanup", () => {
  it('removes only the servers the run noted: never another server on the account, nor a device that is no server', () => {
    // The nightly job's two legs share one test account, and its owner may have more.
    const devices = [
      { id: 1, clientIdentifier: 'fake-machine-0001', provides: 'server' },
      { id: 2, clientIdentifier: 'fake-machine-0002', provides: 'server' },
      { id: 3, clientIdentifier: 'fake-machine-0003', provides: 'client,player' },
      { id: 4, clientIdentifier: 'fake-machine-0004', provides: null },
      { id: 5, clientIdentifier: 'fake-machine-0005', provides: 'server,sync-target' },
    ];
    expect(
      serversToRemove(devices, [
        'fake-machine-0001',
        'fake-machine-0003',
        'fake-machine-0004',
        'fake-machine-0005',
        'fake-machine-0006',
      ]).map((d) => d.id),
    ).toEqual([1, 5]);
    expect(serversToRemove(devices, [])).toEqual([]);
  });
});

describe.skipIf(PLEX_TOKEN_FILE === undefined)(
  'Plex, claimed for the plex.tv test account (the nightly job)',
  () => {
    it('is claimed before it is published, named, given its libraries, and the arrs and Seerr linked to it', async () => {
      const token = await plexToken();
      const home = await makeHome();
      const machineIds: string[] = [];
      const removeAll = () =>
        runTeardown([
          async () => {
            const down = await composeDown(PROJECT);
            expect(down.code, down.stderr).toBe(0);
          },
          () => expectWiringRemoved(PROJECT),
          async () => {
            // Even when the run failed: an offline server left on the account would stay.
            const { machineId } = await preferencesIn(home);
            const ids = [
              ...new Set([...machineIds, machineId, ...(await notedServers())]),
            ].filter((id) => id !== '');
            await removeServers(token, ids);
          },
        ]);
      try {
        await writeFile(
          join(home, 'stack.yaml'),
          plexStack(home, '  radarr: {}\n  seerr: {}\n'),
        );
        await saveToken(home, token);
        const claims: string[] = [];
        const plexTv = noting(plexTvClient(), claims, home);
        const docker = createDockerRuntime({ home, project: PROJECT });
        const noted = { atStart: false };
        const options: ApplyOptions = {
          home,
          catalog,
          host: detectHostFacts(),
          env: process.env,
          runtime: notingAtStart(docker, home, noted),
          probe: nodeProbe,
          project: PROJECT,
          plexTv,
          confirm: () => Promise.resolve(true),
        };
        expect((await plan(options)).bootstrap).toEqual([
          { app: 'plex', unpublished: true },
          { app: 'seerr', unpublished: true },
        ]);
        const first = await apply(options);
        // Plex's own token, which its claim gave it: hidden, and kept out of everything.
        const { machineId, serverToken } = await preferencesIn(home);
        mask(serverToken);
        machineIds.push(machineId);
        expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
        expect(first.outcome).toBe('success');
        expect(first.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
          'set up plex, seerr; published plex, seerr',
        );
        expect(
          noted.atStart,
          "Plex's server noted for the cleanup at its first start",
        ).toBe(true);
        expect(serverToken !== '', 'Plex holds a token from its claim').toBe(true);
        // The container that publishes Plex was made without its claim token.
        expect(await plexState(docker)).toBe(
          `ports 127.0.0.1:${String(PLEX)}, claim none, claimed`,
        );
        // Whose plex.tv says Plex's own token is: the account's. Ids, never tokens, are
        // compared, and only a yes or no is shown.
        const owner = await plexTv.accountId(serverToken);
        expect(owner === (await plexTv.accountId(token)), "Plex is the account's").toBe(
          true,
        );

        // Published, claimed, named, and its libraries made.
        const identity = await getJson<{ MediaContainer: { claimed: boolean } }>(
          PLEX,
          '/identity',
          { Accept: 'application/json' },
        );
        expect(identity.MediaContainer.claimed).toBe(true);
        const plexHeaders = { Accept: 'application/json', 'X-Plex-Token': token };
        const root = await getJson<{ MediaContainer: { friendlyName: string } }>(
          PLEX,
          '/',
          plexHeaders,
        );
        expect(root.MediaContainer.friendlyName).toBe(PROJECT);
        const sections = await getJson<{ MediaContainer: { Directory?: Section[] } }>(
          PLEX,
          '/library/sections',
          plexHeaders,
        );
        expect(
          (sections.MediaContainer.Directory ?? []).map((s) => [
            s.title,
            s.type,
            (s.Location ?? []).map((l) => l.path),
          ]),
        ).toEqual([
          ['Movies', 'movie', ['/data/media/movies']],
          ['TV Shows', 'show', ['/data/media/tv']],
        ]);
        // Each was made by this apply, so Plex's answer to making it listed a library of
        // that name and type: the create step checks it, and fails without one.
        expect(
          wired(first.actions).filter(([resource]) =>
            (resource ?? '').startsWith('plex.library'),
          ),
        ).toEqual([
          ['plex.library_movies', 'created'],
          ['plex.library_tv', 'created'],
        ]);
        // The settings the setup checked before Plex's first publish, as the real Plex
        // gives them: of these types, and safe, or Plex would not have been published.
        const prefs = await getJson<{
          MediaContainer: { Setting?: { id: string; value?: unknown }[] };
        }>(PLEX, '/:/prefs', plexHeaders);
        const pref = (id: string) =>
          prefs.MediaContainer.Setting?.find((s) => s.id === id)?.value;
        expect([
          pref('allowedNetworks') === '',
          typeof pref('enableLocalSecurity'),
          pref('enableLocalSecurity') === -1 || pref('enableLocalSecurity') === 1,
          typeof pref('DlnaEnabled'),
          pref('DlnaEnabled') === false,
        ]).toEqual([true, 'number', true, 'boolean', true]);

        // Each arr tells Plex of its imports, with your token, and its own test passes.
        const store = await readSecretStore(home);
        const secrets = [
          token,
          serverToken,
          ...Object.values(store.apps).flatMap((keys) => Object.values(keys)),
          store.shared?.adminPassword ?? '',
        ];
        for (const arr of [
          { app: 'sonarr', port: 8989 },
          { app: 'radarr', port: 7878 },
        ]) {
          const key = { 'X-Api-Key': store.apps[arr.app]?.apiKey ?? '' };
          const held = (
            await getJson<Connection[]>(arr.port, '/api/v3/notification', key)
          ).find((c) => c.name === 'Plex (Mediaplane)');
          const setting = (name: string) =>
            held?.fields.find((f) => f.name === name)?.value;
          expect([held?.implementation, setting('host'), setting('port')]).toEqual([
            'PlexServer',
            'plex',
            PLEX,
          ]);
          expect(setting('authToken') === '********', `${arr.app} shows it masked`).toBe(
            true,
          );
          const tested = await api(arr.port, '/api/v3/notification/test', key, {
            method: 'POST',
            body: JSON.stringify(held),
            type: 'application/json',
          });
          expect(
            tested.status === 200 ? 'passes' : await servarrFailure(tested, secrets),
            `${arr.app}'s test of it`,
          ).toBe('passes');
        }

        // Seerr: its admin is your account, its Plex the stack's, both libraries enabled.
        const seerrKey = { 'X-Api-Key': store.apps.seerr?.apiKey ?? '' };
        // Seerr answers its key as user 1, its admin: that user is your account. With
        // apply's success, whose setup required its sign-in's own session to be user 1,
        // that shows Seerr's first sign-in, through Plex, made your account its admin.
        const me = await getJson<{ plexId?: unknown }>(
          SEERR,
          '/api/v1/auth/me',
          seerrKey,
        );
        expect(
          me.plexId === (await plexTv.accountId(token)),
          "Seerr's admin is yours",
        ).toBe(true);
        const seerrPlex = await getJson<{
          ip: string;
          port: number;
          useSsl: boolean;
          machineId?: string;
          libraries: { name: string; enabled: boolean }[];
        }>(SEERR, '/api/v1/settings/plex', seerrKey);
        expect([seerrPlex.ip, seerrPlex.port, seerrPlex.useSsl]).toEqual([
          'plex',
          PLEX,
          false,
        ]);
        // Seerr saved the link: it holds Plex's own identifier, which it sets only then.
        expect((seerrPlex.machineId ?? '') !== '', 'Seerr saved its Plex link').toBe(
          true,
        );
        expect(seerrPlex.libraries.map((l) => [l.name, l.enabled])).toEqual([
          ['Movies', true],
          ['TV Shows', true],
        ]);
        expect(
          wired(first.actions)
            .slice(-4)
            .map(([resource]) => resource),
        ).toEqual([
          'seerr.media_server_plex',
          'seerr.server_sonarr',
          'seerr.server_radarr',
          'seerr.setup',
        ]);

        expect(claims.length, 'one claim token, for the first start').toBe(1);
        const plexSecrets = [token, serverToken, ...claims];
        expectNoSecret('what apply wrote', await writtenFiles(home), [
          ...secrets,
          ...claims,
        ]);
        expectNoSecret('.env', await writtenFiles(home, { env: true }), plexSecrets);
        expectNoSecret("apply's result", JSON.stringify(first), [...secrets, ...claims]);

        // A second apply changes nothing, and asks plex.tv for no claim token.
        const again: ApplyResult = await apply({
          ...options,
          confirm: () => Promise.reject(new Error('nothing should need confirming')),
        });
        expect(
          again.plan.wiring
            .filter((w) => w.action !== 'unchanged')
            .map((w) => `${w.resource} ${w.action} ${(w.changes ?? []).join(',')}`),
          'wiring changed',
        ).toEqual([]);
        expect(again.outcome).toBe('no-changes');
        expect(claims.length, 'no claim token asked for by the second apply').toBe(1);
      } catch (failure) {
        await removeAll().catch((also: unknown) => {
          console.error('teardown failed too:', also);
        });
        throw failure;
      }
      await removeAll();
    }, 1_800_000);
  },
);
