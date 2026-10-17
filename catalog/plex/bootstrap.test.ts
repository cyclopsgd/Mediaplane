import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AppApiError,
  bootstrapApps,
  BootstrapFailed,
  createAppApi,
  firstStartEnv,
  HelperError,
  inspectBootstrap,
  plexTvClient,
  readSecretStore,
  resolveStack,
  RuntimeError,
  startVariables,
  NO_PLEX_TV,
  type AppApi,
  type BootstrapContext,
  type PlexTv,
  type ResolvedApp,
  type ResolvedStack,
  type SecretStore,
} from '@mediaplane/engine';
import {
  claimFakePlex,
  closedPort,
  FAKE_PLEX_ACCOUNT,
  fakeContainer,
  fakePlexTv,
  fakeRuntime,
  fakeStackApis,
  type FakeReply,
  type FakeRuntimeOptions,
  FIXTURE_HOST,
  fixtureConfig,
  freshAppState,
  PLEX_PREFERENCES,
  tempDir,
  thrown,
  wiringStack,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import { plexBootstrap, PREFERENCES } from './bootstrap';

const TOKEN = FAKE_PLEX_ACCOUNT.token;
const ADMIN = { username: 'admin', password: 'fake-admin-password' };
/** Another plex.tv account, which can claim a Plex too. */
const SOMEONE = { id: 7_000_099, token: 'someone-plex-token-9' };

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: plex
plex: { token: { file: secrets/plex-token } }
apps:
  sonarr: {}
  qbittorrent: { vpn: false }
`;

/** STACK, resolved in `home`. */
function stackIn(home: string): ResolvedStack {
  const resolved = resolveStack(fixtureConfig(STACK), catalog, FIXTURE_HOST, home);
  if (resolved.stack === undefined) throw new Error(JSON.stringify(resolved.diagnostics));
  return resolved.stack;
}

/**
 * The stack's fakes, Plex as it first starts, keeping its Preferences.xml in a home of
 * its own, plex.tv knowing your account and SOMEONE's, and a client of Plex with your
 * token, whose waits pass at once on a clock of its own (a deadline of `deadlineMs` on
 * it).
 */
async function plexOf(deadlineMs = 0) {
  const home = await tempDir('mediaplane-plex-');
  const plexTv = await fakePlexTv();
  plexTv.state.accounts.push({ ...SOMEONE });
  const apis = await fakeStackApis(plexTv.state);
  const state = freshAppState();
  state.plex.configDir = join(home, 'appdata', 'plex');
  apis.apps.set('plex', state);
  let clock = 0;
  const api = createAppApi({
    name: 'Plex',
    service: 'plex',
    port: 32400,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    // As the setup's own client is: Plex's key is yours, which it doesn't carry.
    key: { scheme: 'x-plex-token' },
    secrets: [TOKEN],
    retry: {
      deadlineMs,
      now: () => clock,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
    },
  });
  const ctx: BootstrapContext = {
    keys: { plex: { token: TOKEN } },
    plexTv: plexTv.client,
  };
  return { api, state, plexTv, ctx, stack: stackIn(home) };
}

describe("Plex's first-run setup", () => {
  it('is open until Plex is claimed, as Plex says to anyone', async () => {
    const { api, state, plexTv } = await plexOf();
    expect(await plexBootstrap.open(api)).toBe(true);
    const claim = await plexTv.client.claimToken(TOKEN);
    expect(claimFakePlex(state.plex, claim, plexTv.state)).toBe(true);
    expect(await plexBootstrap.open(api)).toBe(false);
    expect(plexBootstrap.done.path).toBe(PLEX_PREFERENCES);
    expect(PREFERENCES).toBe(PLEX_PREFERENCES);
  });

  it('gives its first start a claim token for your account, fetched with your token', async () => {
    const { plexTv, ctx, stack } = await plexOf();
    const env = await plexBootstrap.firstStart?.(stack, ctx);
    expect(env).toEqual({ PLEX_CLAIM: plexTv.state.claims[0]?.token });
    expect(plexTv.state.claims).toEqual([
      { token: env?.PLEX_CLAIM, account: FAKE_PLEX_ACCOUNT.id, used: false },
    ]);
  });

  it("says what to do when it can't get a claim token, and never shows the token", async () => {
    const { stack, plexTv } = await plexOf();
    const refused = await thrown(
      Promise.resolve(
        plexBootstrap.firstStart?.(stack, {
          keys: { plex: { token: 'revoked-plex-token-0' } },
          plexTv: plexTv.client,
        }),
      ),
    );
    expect(refused).toBeInstanceOf(BootstrapFailed);
    expect(refused).toMatchObject({
      message:
        "Plex's first start needs a claim token from plex.tv, which Mediaplane couldn't get, so nothing was started: plex.tv refused the Plex token (HTTP 401) (GET /api/claim/token.json)",
      hint: 'plex.tv refused your Plex token: it was revoked, or is not one. Run "mediaplane plex-login" to sign in again, then run apply again',
    });
    const away: PlexTv = plexTvClient({
      base: `http://127.0.0.1:${String(await closedPort())}`,
      sleep: () => Promise.resolve(),
    });
    const unreached = await thrown(
      Promise.resolve(
        plexBootstrap.firstStart?.(stack, {
          keys: { plex: { token: TOKEN } },
          plexTv: away,
        }),
      ),
    );
    expect(unreached).toMatchObject({
      hint: 'check that this host reaches plex.tv, then run apply again',
    });
    expect((unreached as Error).message).not.toContain(TOKEN);
    // A 403 that won't clear may be about the account, not the host's connection.
    plexTv.state.failing.push({ path: '/api/claim/token.json', status: 403 });
    const forbidden = await thrown(
      Promise.resolve(
        plexBootstrap.firstStart?.(stack, {
          keys: { plex: { token: TOKEN } },
          plexTv: plexTv.client,
        }),
      ),
    );
    expect(forbidden).toMatchObject({
      hint: 'check that this host reaches plex.tv, or that this plex.tv account may claim a server, then run apply again',
    });
    expect((forbidden as Error).message).toContain('(HTTP 403)');
    const none = await thrown(
      Promise.resolve(plexBootstrap.firstStart?.(stack, { keys: {}, plexTv: away })),
    );
    expect(none).toMatchObject({
      message:
        "Plex can't be claimed: Mediaplane has no Plex token, so nothing was started",
      hint: 'run "mediaplane plex-login", then run apply again',
    });
  });

  it('treats a failure to call plex.tv at all as plex.tv not answering, naming only its kind', async () => {
    const { api, state, plexTv, stack } = await plexOf();
    // A rejection that needn't be an Error, to see what a failure of any kind shows.
    /* eslint-disable @typescript-eslint/prefer-promise-reject-errors */
    const broken = (cause: unknown): PlexTv => ({
      ...plexTv.client,
      claimToken: () => Promise.reject(cause),
      accountId: () => Promise.reject(cause),
    });
    /* eslint-enable @typescript-eslint/prefer-promise-reject-errors */
    // The helper or Docker failed: what they said may hold anything, so none of it shows.
    const text = `fake: docker said ${TOKEN}`;
    for (const [cause, kind] of [
      [new HelperError(text), 'HelperError'],
      [new RuntimeError(text), 'RuntimeError'],
      [text, 'not an Error'],
    ] as const) {
      const unclaimed = await thrown(
        Promise.resolve(
          plexBootstrap.firstStart?.(stack, {
            keys: { plex: { token: TOKEN } },
            plexTv: broken(cause),
          }),
        ),
      );
      expect(unclaimed).toBeInstanceOf(BootstrapFailed);
      expect(unclaimed).toMatchObject({
        message: `Plex's first start needs a claim token from plex.tv, which Mediaplane couldn't get, so nothing was started: the call to plex.tv failed (${kind})`,
        hint: 'check that this host reaches plex.tv, then run apply again',
      });
    }
    claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
    for (const [cause, kind] of [
      [new HelperError(text), 'HelperError'],
      [new RuntimeError(text), 'RuntimeError'],
    ] as const) {
      const failed = await thrown(
        plexBootstrap.run(api, ADMIN, stack, {
          keys: { plex: { token: TOKEN } },
          plexTv: broken(cause),
        }),
      );
      expect(failed).toBeInstanceOf(AppApiError);
      expect(failed).toMatchObject({
        kind: 'auth',
        unsure: true,
        message: `Plex at http://plex:32400 (127.0.0.1) is claimed, and Mediaplane couldn't tell whether by your plex.tv account: the call to plex.tv failed (${kind})`,
      });
      expect((failed as Error).message).not.toContain(TOKEN);
    }
  });

  it('takes a Plex your account claimed, waiting while it claims itself as it starts', async () => {
    const { api, state, plexTv, ctx, stack } = await plexOf(60_000);
    claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
    // It says it is unclaimed twice more, as the image restarts it after its claim.
    state.plex.claimingFor = 2;
    expect(await plexBootstrap.run(api, ADMIN, stack, ctx)).toBeUndefined();
    expect(state.plex.claimingFor).toBe(0);
  });

  it('keeps a Plex of yours unpublished that lets a network in without a sign-in, naming the setting and what to do', async () => {
    const { api, state, plexTv, ctx, stack } = await plexOf();
    claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
    // Set while it was unclaimed, by whoever reached it: it survives the claim (probed).
    state.plex.allowedNetworks = '192.0.2.0/255.255.255.0';
    const failed = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
    expect(failed).toMatchObject({
      kind: 'rejected',
      message: `Plex at http://plex:32400 (127.0.0.1) is yours, but lets "192.0.2.0/255.255.255.0" in without a sign-in (allowedNetworks). Mediaplane never sets allowedNetworks: this may have been set while Plex was unclaimed, so Plex stays unpublished. Stop it ("mediaplane status plex" names its container; then "docker stop <container>"), reset allowedNetworks in appdata/plex/${PLEX_PREFERENCES} (delete the attribute, or else set it to its default as the file writes it: allowedNetworks=""), then run apply again`,
    });
    // Cleared, it is taken.
    state.plex.allowedNetworks = '';
    expect(await plexBootstrap.run(api, ADMIN, stack, ctx)).toBeUndefined();
  });

  /** What GET /:/prefs answers when it doesn't say that allowedNetworks is empty. */
  const UNSAID: [string, FakeReply][] = [
    [
      'is missing',
      {
        status: 200,
        body: { MediaContainer: { Setting: [{ id: 'FriendlyName', value: '' }] } },
      },
    ],
    [
      'is a number',
      {
        status: 200,
        body: { MediaContainer: { Setting: [{ id: 'allowedNetworks', value: 5 }] } },
      },
    ],
    [
      'is null',
      {
        status: 200,
        body: { MediaContainer: { Setting: [{ id: 'allowedNetworks', value: null }] } },
      },
    ],
    [
      'is true',
      {
        status: 200,
        body: { MediaContainer: { Setting: [{ id: 'allowedNetworks', value: true }] } },
      },
    ],
  ];

  it('keeps a Plex of yours unpublished that does not say allowedNetworks is empty: missing, or not text', async () => {
    for (const [what, answer] of UNSAID) {
      const { api, state, plexTv, ctx, stack } = await plexOf();
      claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
      state.plex.prefsAnswer = answer;
      const failed = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
      expect(failed, `allowedNetworks ${what}`).toMatchObject({ kind: 'rejected' });
      expect((failed as Error).message).toContain(
        'is yours, but lets networks it does not name in without a sign-in (allowedNetworks)',
      );
    }
  });

  it('keeps a Plex of yours unpublished when its settings are not read: a 5xx, no answer, or an answer that is not settings', async () => {
    const { api, state, plexTv, ctx, stack } = await plexOf();
    claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
    state.plex.prefsAnswer = { status: 500, body: 'fake: broken' };
    const broken = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
    expect(broken).toBeInstanceOf(AppApiError);
    expect((broken as Error).message).toContain('(HTTP 500)');
    expect((broken as Error).message).toContain('GET /:/prefs');
    state.plex.prefsAnswer = { status: 200, body: { MediaContainer: { size: 0 } } };
    const odd = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
    expect(odd).toBeInstanceOf(AppApiError);
    expect((odd as Error).message).toContain('GET /:/prefs');
    state.plex.prefsAnswer = {
      status: 200,
      body: { MediaContainer: { Setting: [{ id: 'allowedNetworks' }] } },
    };
    expect(await thrown(plexBootstrap.run(api, ADMIN, stack, ctx))).toBeInstanceOf(
      AppApiError,
    );
    state.plex.prefsAnswer = { status: 200, body: 'not json at all' };
    expect(await thrown(plexBootstrap.run(api, ADMIN, stack, ctx))).toBeInstanceOf(
      AppApiError,
    );
    // Plex doesn't answer: the client's own failure comes out, never a pass.
    const silent: AppApi = {
      ...api,
      withKey: () => ({
        ...api,
        get: () =>
          Promise.reject(
            new AppApiError('Plex at http://plex:32400 (127.0.0.1) did not answer', {
              kind: 'unreachable',
            }),
          ),
      }),
    };
    state.plex.prefsAnswer = undefined;
    expect(await thrown(plexBootstrap.run(silent, ADMIN, stack, ctx))).toMatchObject({
      kind: 'unreachable',
    });
  });

  it('shows the networks Plex lets in as quoted text of at most 120 characters, without control characters, as whoever reached it unclaimed chose them', async () => {
    const { api, state, plexTv, ctx, stack } = await plexOf();
    claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
    const letters = 'A'.repeat(200);
    state.plex.allowedNetworks = `\u001b[31m192.0.2.0/24\n\r\t\u0000${letters}\u2028"quoted"\u007f`;
    const failed = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
    expect(failed).toMatchObject({ kind: 'rejected' });
    const said = (failed as Error).message;
    // Controls stripped (the "[31m" after the ESC is plain text), then 120 characters kept.
    const kept = `[31m192.0.2.0/24${letters}`.slice(0, 120);
    expect(said).toContain(`lets ${JSON.stringify(`${kept}…`)} in without a sign-in`);
    expect(said).not.toMatch(/[\p{Cc}\p{Zl}\p{Zp}]/u);
    expect(said).not.toContain('quoted');
    // A short one is shown whole, quoted.
    state.plex.allowedNetworks = '192.0.2.0/255.255.255.0';
    const short = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
    expect((short as Error).message).toContain(
      'lets "192.0.2.0/255.255.255.0" in without a sign-in',
    );
  });

  /** GET /:/prefs as Plex answers it, with `settings` in place of the defaults (undefined: left out). */
  function prefsWith(settings: Record<string, unknown>): FakeReply {
    const all: Record<string, unknown> = {
      FriendlyName: '',
      allowedNetworks: '',
      enableLocalSecurity: -1,
      DlnaEnabled: false,
      ...settings,
    };
    return {
      status: 200,
      body: {
        MediaContainer: {
          Setting: Object.entries(all)
            .filter(([, value]) => value !== undefined)
            .map(([id, value]) => ({ id, value })),
        },
      },
    };
  }

  it('takes a Plex whose local security is its default or stricter, and whose DLNA is off', async () => {
    for (const security of [-1, 1]) {
      const { api, state, plexTv, ctx, stack } = await plexOf();
      claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
      state.plex.enableLocalSecurity = security;
      expect(await plexBootstrap.run(api, ADMIN, stack, ctx), String(security)).toBe(
        undefined,
      );
    }
  });

  it('keeps unpublished a Plex of yours whose local security is neither -1 nor 1, or whose DLNA is on, naming the setting and its value', async () => {
    const cases: [string, FakeReply, string][] = [
      [
        'local security 0',
        prefsWith({ enableLocalSecurity: 0 }),
        'has enableLocalSecurity at 0, not -1 or 1, so a client may be let in without a sign-in. Mediaplane never sets enableLocalSecurity: this may have been set while Plex was unclaimed, so Plex stays unpublished.',
      ],
      [
        'local security 2',
        prefsWith({ enableLocalSecurity: 2 }),
        'has enableLocalSecurity at 2,',
      ],
      [
        'local security as text',
        prefsWith({ enableLocalSecurity: '1' }),
        'has enableLocalSecurity at "1",',
      ],
      [
        'local security null',
        prefsWith({ enableLocalSecurity: null }),
        'has enableLocalSecurity at a value it does not give,',
      ],
      [
        'local security missing',
        prefsWith({ enableLocalSecurity: undefined }),
        'has enableLocalSecurity at a value it does not give,',
      ],
      [
        'DLNA on',
        prefsWith({ DlnaEnabled: true }),
        'has DlnaEnabled at true, not false, and DLNA streams without a sign-in. Mediaplane never sets DlnaEnabled:',
      ],
      [
        'DLNA as text',
        prefsWith({ DlnaEnabled: '0' }),
        'has DlnaEnabled at "0", not false,',
      ],
      [
        'DLNA missing',
        prefsWith({ DlnaEnabled: undefined }),
        'has DlnaEnabled at a value it does not give,',
      ],
    ];
    for (const [what, answer, said] of cases) {
      const { api, state, plexTv, ctx, stack } = await plexOf();
      claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
      state.plex.prefsAnswer = answer;
      const failed = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
      expect(failed, what).toMatchObject({ kind: 'rejected' });
      expect((failed as Error).message, what).toContain(
        `Plex at http://plex:32400 (127.0.0.1) is yours, but ${said}`,
      );
      expect((failed as Error).message, what).toContain(
        'Stop it ("mediaplane status plex" names its container; then "docker stop <container>"), reset ',
      );
    }
  });

  it("gives each setting's default as Preferences.xml writes it, after deleting the attribute, and says 'this' of one setting", async () => {
    for (const [settings, id, form] of [
      [{ enableLocalSecurity: 0 }, 'enableLocalSecurity', 'enableLocalSecurity="-1"'],
      [{ DlnaEnabled: true }, 'DlnaEnabled', 'DlnaEnabled="0"'],
    ] as const) {
      const { api, state, plexTv, ctx, stack } = await plexOf();
      claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
      state.plex.prefsAnswer = prefsWith(settings);
      const said = ((await thrown(plexBootstrap.run(api, ADMIN, stack, ctx))) as Error)
        .message;
      expect(said).toContain(`: this may have been set while Plex was unclaimed`);
      expect(said).toContain(
        `reset ${id} in appdata/plex/${PLEX_PREFERENCES} (delete the attribute, or else set it to its default as the file writes it: ${form}), then run apply again`,
      );
    }
  });

  it('names every setting that fails at once, each with its value and its default', async () => {
    const { api, state, plexTv, ctx, stack } = await plexOf();
    claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
    state.plex.allowedNetworks = '192.0.2.0/24';
    state.plex.enableLocalSecurity = 0;
    state.plex.dlnaEnabled = true;
    const failed = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
    expect(failed).toMatchObject({
      kind: 'rejected',
      message: `Plex at http://plex:32400 (127.0.0.1) is yours, but lets "192.0.2.0/24" in without a sign-in (allowedNetworks); has enableLocalSecurity at 0, not -1 or 1, so a client may be let in without a sign-in; has DlnaEnabled at true, not false, and DLNA streams without a sign-in. Mediaplane never sets allowedNetworks, enableLocalSecurity, DlnaEnabled: these may have been set while Plex was unclaimed, so Plex stays unpublished. Stop it ("mediaplane status plex" names its container; then "docker stop <container>"), reset allowedNetworks, enableLocalSecurity, DlnaEnabled in appdata/plex/${PLEX_PREFERENCES} (delete each attribute, or else set each to its default as the file writes it: allowedNetworks="", enableLocalSecurity="-1", DlnaEnabled="0"), then run apply again`,
    });
  });

  it("keeps a Plex that didn't claim itself unpublished, saying why", async () => {
    const { api, ctx, stack } = await plexOf(60_000);
    const failed = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
    expect(failed).toBeInstanceOf(AppApiError);
    expect(failed).toMatchObject({
      kind: 'rejected',
      message:
        'Plex at http://plex:32400 (127.0.0.1) didn\'t claim itself as it started, so it stays unpublished: its claim token may have run out, or it couldn\'t reach plex.tv; its log says which ("mediaplane status plex" names its container)',
    });
  });

  it('refuses a Plex another plex.tv account claimed, asking plex.tv, not Plex', async () => {
    const { api, state, plexTv, ctx, stack } = await plexOf();
    claimFakePlex(
      state.plex,
      await plexTv.client.claimToken(SOMEONE.token),
      plexTv.state,
    );
    const failed = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
    expect(failed).toMatchObject({
      kind: 'auth',
      unsure: false,
      message:
        "Plex at http://plex:32400 (127.0.0.1) is claimed by another plex.tv account than yours: plex.tv says the token its claim gave it is another account's",
    });
    expect(plexTv.state.calls.slice(-2)).toEqual([
      'GET /api/v2/user',
      'GET /api/v2/user',
    ]);
    expect((failed as Error).message).not.toContain(state.plex.serverToken);
  });

  it("refuses another account's Plex that says the machine identifier of a server of yours", async () => {
    const { api, state, plexTv, ctx, stack } = await plexOf();
    // A Plex of yours elsewhere, whose machine identifier anyone who reaches it can read.
    plexTv.state.servers.push({
      machineId: 'your-other-plex-0001',
      owner: FAKE_PLEX_ACCOUNT.id,
      name: 'Living room',
      token: 'fake-server-token-99',
    });
    claimFakePlex(
      state.plex,
      await plexTv.client.claimToken(SOMEONE.token),
      plexTv.state,
    );
    // Its admin gives it that identifier, as Plex's PUT /:/prefs takes it (probed).
    state.plex.machineId = 'your-other-plex-0001';
    const failed = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
    expect(failed).toMatchObject({ kind: 'auth', unsure: false });
    expect((failed as Error).message).toContain('is claimed by another plex.tv account');
  });

  it('refuses a Plex whose token plex.tv refuses, as once it is removed from its account', async () => {
    const { api, state, plexTv, ctx, stack } = await plexOf();
    claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
    plexTv.state.servers = [];
    const failed = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
    expect(failed).toMatchObject({
      kind: 'auth',
      unsure: false,
      message:
        'Plex at http://plex:32400 (127.0.0.1) is claimed by no plex.tv account of yours: plex.tv refuses the token its claim gave it, as it does once the server is removed from its account',
    });
  });

  it("refuses, as unsure, a Plex when plex.tv can't be asked whose it is", async () => {
    const { api, state, plexTv, ctx, stack } = await plexOf();
    claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
    plexTv.state.failing.push({ path: '/api/v2/user', status: 503 });
    const failed = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
    expect(failed).toMatchObject({ kind: 'auth', unsure: true });
    expect((failed as Error).message).toContain(
      "is claimed, and Mediaplane couldn't tell whether by your plex.tv account: plex.tv failed (HTTP 503)",
    );
  });

  it("refuses, as unsure, a claimed Plex whose Preferences.xml holds no token, and one Mediaplane can't read", async () => {
    const { api, state, plexTv, ctx, stack } = await plexOf();
    claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
    state.plex.serverToken = '';
    const tokenless = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
    expect(tokenless).toMatchObject({
      kind: 'auth',
      unsure: true,
      message:
        "Plex at http://plex:32400 (127.0.0.1) is claimed, and its Preferences.xml holds no token of its claim, so Mediaplane couldn't tell whether by your plex.tv account",
    });
    const other = await plexOf();
    other.state.plex.configDir = undefined;
    claimFakePlex(
      other.state.plex,
      await other.plexTv.client.claimToken(TOKEN),
      other.plexTv.state,
    );
    const unread = await thrown(
      plexBootstrap.run(other.api, ADMIN, other.stack, other.ctx),
    );
    expect(unread).toMatchObject({
      kind: 'rejected',
      message: `Plex at http://plex:32400 (127.0.0.1) is claimed, and Mediaplane can't read appdata/plex/${PLEX_PREFERENCES} (ENOENT) to tell by whose plex.tv account`,
    });
  });

  it('says plex.tv refused your token when asked whose Plex it is, never as claimed', async () => {
    const { api, state, plexTv, stack } = await plexOf();
    claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
    const failed = await thrown(
      plexBootstrap.run(api, ADMIN, stack, {
        keys: { plex: { token: 'revoked-plex-token-0' } },
        plexTv: plexTv.client,
      }),
    );
    expect(failed).toMatchObject({ kind: 'rejected' });
    expect((failed as Error).message).toContain(
      'Run "mediaplane plex-login" to sign in again',
    );
    expect((failed as Error).message).not.toContain('revoked-plex-token');
  });

  it('gives the safe remedies for a Plex claimed by someone else first, and starting afresh last', () => {
    const hint = plexBootstrap.claimedHint?.(
      wiringStack(catalog, STACK),
      'mediaplane-plex-1',
    );
    expect(hint).toBe(
      'First: if that plex.tv account is yours too, run "mediaplane plex-login --force" and sign in as it (without --force, plex-login keeps a saved token that plex.tv still takes), then run apply again. Or second, keeping what Plex holds: stop it ("docker stop mediaplane-plex-1"), remove every attribute whose name starts with PlexOnline from appdata/plex/Library/Application Support/Plex Media Server/Preferences.xml, then run apply again, which claims it as yours. Last, only if you don\'t need what it holds: start it afresh, as the runbook says',
    );
  });
});

describe("Plex's first start, when it can't be prepared", () => {
  /** Plex's stack, and a Docker with Plex running (unless `extra` says otherwise). */
  async function startOf(extra: Partial<FakeRuntimeOptions> = {}) {
    const home = await tempDir('mediaplane-plex-');
    const calls: string[] = [];
    const runtime = fakeRuntime({
      containers: [fakeContainer('plex', 'fake-plex')],
      calls,
      ...extra,
    });
    const pending = [{ app: 'plex', unpublished: true }];
    /** A context whose plex.tv fails to give a claim token with `cause`. */
    const failing = (cause: Error): BootstrapContext => ({
      keys: { plex: { token: TOKEN } },
      plexTv: { ...NO_PLEX_TV, claimToken: () => Promise.reject(cause) },
    });
    return { runtime, calls, stack: stackIn(home), pending, failing };
  }

  it('stops a Plex that runs, and says so, whatever the helper or Docker failed with', async () => {
    const { runtime, calls, stack, pending, failing } = await startOf();
    const failed = await thrown(
      startVariables(
        stack,
        pending,
        failing(new HelperError('fake: no helper')),
        runtime,
        {},
      ),
    );
    expect(failed).toBeInstanceOf(BootstrapFailed);
    expect(failed).toMatchObject({
      message:
        "Plex's first start needs a claim token from plex.tv, which Mediaplane couldn't get, so nothing was started: the call to plex.tv failed (HelperError); Mediaplane stopped plex, which ran, but isn't shown to be yours, so that it isn't left published",
      hint: 'check that this host reaches plex.tv, then run apply again',
    });
    expect(calls).toContain('stop plex');
  });

  it('stops it too, and says what it did, when the failure is not a BootstrapFailed', async () => {
    const { runtime, calls, stack, pending } = await startOf();
    const cause = new Error(`fake: boom holds ${TOKEN}`);
    const odd: ResolvedStack = {
      ...stack,
      apps: stack.apps.map((app) =>
        app.def.id === 'plex' && app.def.bootstrap !== undefined
          ? {
              ...app,
              def: {
                ...app.def,
                bootstrap: {
                  ...app.def.bootstrap,
                  firstStart: () => Promise.reject(cause),
                },
              },
            }
          : app,
      ),
    };
    const failed = await thrown(
      startVariables(odd, pending, { keys: {}, plexTv: NO_PLEX_TV }, runtime, {}),
    );
    expect(failed).toBeInstanceOf(BootstrapFailed);
    expect(failed).toMatchObject({
      message:
        "plex's first start couldn't be prepared (Error), so nothing was started; Mediaplane stopped plex, which ran, but isn't shown to be yours, so that it isn't left published",
      cause,
    });
    expect((failed as Error).message).not.toContain(TOKEN);
    expect(calls).toContain('stop plex');
  });

  it("says to stop it yourself when it couldn't be stopped, whether Docker said no or threw", async () => {
    const said = await startOf({ stop: { ok: false, error: 'fake: docker said no' } });
    const refused = await thrown(
      startVariables(
        said.stack,
        said.pending,
        said.failing(new HelperError('fake')),
        said.runtime,
        {},
      ),
    );
    expect((refused as Error).message).toContain(
      "; plex runs, isn't shown to be yours, and couldn't be stopped: fake: docker said no. Stop it yourself",
    );
    const threw = await startOf();
    const thrownStop = await thrown(
      startVariables(
        threw.stack,
        threw.pending,
        threw.failing(new HelperError('fake')),
        {
          ...threw.runtime,
          stop: () => Promise.reject(new RuntimeError('fake: cannot spawn docker')),
        },
        {},
      ),
    );
    expect(thrownStop).toBeInstanceOf(BootstrapFailed);
    expect((thrownStop as Error).message).toContain(
      "the call to plex.tv failed (HelperError); plex runs, isn't shown to be yours, and couldn't be stopped: fake: cannot spawn docker. Stop it yourself",
    );
  });

  it("stops every app it was for when Docker can't list the containers, and stops nothing when none runs", async () => {
    const unknown = await startOf();
    const listing = await thrown(
      startVariables(
        unknown.stack,
        unknown.pending,
        unknown.failing(new HelperError('fake')),
        {
          ...unknown.runtime,
          containers: () => Promise.reject(new RuntimeError('fake: no docker')),
        },
        {},
      ),
    );
    expect((listing as Error).message).toContain(
      "; Mediaplane stopped plex, which may have run, but isn't shown to be yours, so that it isn't left published",
    );
    expect(unknown.calls).toContain('stop plex');
    const idle = await startOf({ containers: [] });
    const plain = await thrown(
      startVariables(
        idle.stack,
        idle.pending,
        idle.failing(new HelperError('fake')),
        idle.runtime,
        {},
      ),
    );
    expect(plain).toBeInstanceOf(BootstrapFailed);
    expect((plain as Error).message).not.toContain('stopped');
    expect(idle.calls).not.toContain('stop plex');
  });

  it('wraps a failure that is not a BootstrapFailed by its kind only, when nothing runs too', async () => {
    const { runtime, calls, stack, pending } = await startOf({ containers: [] });
    const cause = new Error(`fake: boom holds ${TOKEN}`);
    const odd: ResolvedStack = {
      ...stack,
      apps: stack.apps.map((app) =>
        app.def.id === 'plex' && app.def.bootstrap !== undefined
          ? {
              ...app,
              def: {
                ...app.def,
                bootstrap: {
                  ...app.def.bootstrap,
                  firstStart: () => Promise.reject(cause),
                },
              },
            }
          : app,
      ),
    };
    const failed = await thrown(
      startVariables(odd, pending, { keys: {}, plexTv: NO_PLEX_TV }, runtime, {}),
    );
    expect(failed).toBeInstanceOf(BootstrapFailed);
    expect(failed).toMatchObject({
      message: "plex's first start couldn't be prepared (Error), so nothing was started",
      cause,
    });
    expect((failed as Error).message).not.toContain(TOKEN);
    expect(calls.some((call) => call.startsWith('stop'))).toBe(false);
  });

  it('stops every app the plan starts unpublished that runs, such as a published Seerr, and says so of each', async () => {
    const home = await tempDir('mediaplane-plex-');
    const resolved = resolveStack(
      fixtureConfig(`${STACK}  seerr: {}\n`),
      catalog,
      FIXTURE_HOST,
      home,
    );
    if (resolved.stack === undefined) throw new Error('no stack');
    const calls: string[] = [];
    // As an apply before Slice 7 left them: Plex unclaimed, and Seerr set up by hand,
    // both published. Sonarr, set up, runs too.
    const runtime = fakeRuntime({
      containers: [
        fakeContainer('sonarr', 'fake-sonarr'),
        fakeContainer('seerr', 'fake-seerr'),
        fakeContainer('plex', 'fake-plex'),
      ],
      calls,
    });
    const pending = [
      { app: 'plex', unpublished: true },
      { app: 'seerr', unpublished: true },
    ];
    /** A context whose plex.tv can't give a claim token. */
    const failing = (): BootstrapContext => ({
      keys: { plex: { token: TOKEN } },
      plexTv: {
        ...NO_PLEX_TV,
        claimToken: () => Promise.reject(new HelperError('fake: no helper')),
      },
    });
    const failed = await thrown(
      startVariables(resolved.stack, pending, failing(), runtime, {}),
    );
    expect(failed).toBeInstanceOf(BootstrapFailed);
    expect((failed as Error).message).toBe(
      "Plex's first start needs a claim token from plex.tv, which Mediaplane couldn't get, so nothing was started: the call to plex.tv failed (HelperError); Mediaplane stopped plex and seerr, which ran, but aren't shown to be yours, so that they aren't left published",
    );
    expect(calls.filter((call) => call.startsWith('stop'))).toEqual(['stop plex seerr']);
    // Not stopped: each is named, with what to do.
    const refused = await thrown(
      startVariables(
        resolved.stack,
        pending,
        failing(),
        { ...runtime, stop: () => Promise.resolve({ ok: false, error: 'fake: no' }) },
        {},
      ),
    );
    expect((refused as Error).message).toContain(
      "; plex and seerr run, aren't shown to be yours, and couldn't be stopped: fake: no. Stop them yourself",
    );
  });
});

describe("Plex's setup, as apply's bootstrap step runs it", () => {
  /**
   * Plex in a home of its own, set up by the engine's step as `apply` would run it:
   * planned from its Preferences.xml and the store, its first start given its claim, which
   * it trades at the fake plex.tv as the image does, then set up. `published` has, for
   * each publishing up, the apps it leaves unpublished.
   */
  async function stepOf() {
    const store: SecretStore = {
      version: 1,
      apps: {},
      shared: { adminPassword: ADMIN.password },
    };
    const home = await tempDir('mediaplane-plex-');
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'plex-token'), `${TOKEN}\n`);
    const plexTv = await fakePlexTv();
    plexTv.state.accounts.push({ ...SOMEONE });
    const apis = await fakeStackApis(plexTv.state);
    const state = freshAppState();
    state.plex.configDir = join(home, 'appdata', 'plex');
    apis.apps.set('plex', state);
    const stack = stackIn(home);
    const runtime = fakeRuntime({
      containers: [fakeContainer('plex', 'fake-plex')],
      addresses: apis.addresses,
    });
    const published: string[][] = [];
    const given = { plex: { token: TOKEN } };
    /** How many of Plex's settings were asked for so far. */
    const prefsAsked = () =>
      apis.app.requests.filter(
        (r) => r.headers.host?.startsWith('plex') === true && r.path === '/:/prefs',
      ).length;
    /** That count, as plex.tv started and ended each ask whose a token is. */
    const prefsWhenAsked: number[] = [];
    const client: PlexTv = {
      ...plexTv.client,
      accountId: async (token) => {
        prefsWhenAsked.push(prefsAsked());
        try {
          return await plexTv.client.accountId(token);
        } finally {
          prefsWhenAsked.push(prefsAsked());
        }
      },
    };
    const ctx: BootstrapContext = { keys: given, plexTv: client };
    const run = async (from: SecretStore) => {
      const pending = (await inspectBootstrap(stack, from)).changes;
      // The start step: Plex's first start, with what its setup gives it.
      const env = await firstStartEnv(stack, pending, ctx);
      claimFakePlex(state.plex, env.plex?.PLEX_CLAIM, plexTv.state);
      const set = await bootstrapApps({
        home,
        stack,
        store: from,
        values: {},
        given,
        plexTv: client,
        env: {},
        runtime,
        project: 'mediaplane',
        pending,
        publish: (unpublished) => {
          published.push([...unpublished]);
          return Promise.resolve();
        },
        seams: apis.seams,
      });
      return { pending, env, ...set };
    };
    return {
      home,
      state,
      plexTv,
      published,
      run,
      store,
      ctx,
      stack,
      apis,
      prefsAsked,
      prefsWhenAsked,
    };
  }

  it('claims a fresh Plex with its claim token, records it, and publishes it', async () => {
    const { home, state, published, run, store, apis } = await stepOf();
    const first = await run(store);
    // Plex is asked whether it is claimed without your token, which it may not be yours
    // to have: every question of the setup's, and the re-check before publishing.
    const identity = apis.app.requests.filter(
      (r) => r.headers.host?.startsWith('plex') === true && r.path === '/identity',
    );
    expect(identity.length).toBeGreaterThanOrEqual(3);
    expect(identity.filter((r) => r.headers['x-plex-token'] !== undefined)).toEqual([]);
    // Plex got your token only once plex.tv said it is yours: to check that it lets no
    // network in without a sign-in.
    expect(
      apis.app.requests
        .filter((r) => r.headers.host?.startsWith('plex') === true)
        .filter((r) => r.headers['x-plex-token'] !== undefined)
        .map((r) => r.path),
    ).toEqual(['/:/prefs']);
    expect(first.pending).toEqual([{ app: 'plex', unpublished: true }]);
    expect(Object.keys(first.env)).toEqual(['plex']);
    expect(state.plex.owner).toBe(FAKE_PLEX_ACCOUNT.id);
    expect(first.detail).toBe('set up plex; published plex');
    expect(published).toEqual([[]]);
    expect((await readSecretStore(home)).setUp).toEqual(['plex']);
    // Recorded, and its Preferences.xml says it is claimed: nothing more to do.
    const again = await run(first.store);
    expect(again.pending).toEqual([]);
    expect(again.env).toEqual({});
  });

  it('keeps a Plex claimed by someone else unpublished, on every apply, with the safe remedies first', async () => {
    const { home, state, plexTv, published, run, store, apis } = await stepOf();
    claimFakePlex(
      state.plex,
      await plexTv.client.claimToken(SOMEONE.token),
      plexTv.state,
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const failed = await thrown(run(store));
      expect(failed).toBeInstanceOf(BootstrapFailed);
      const said = (failed as Error).message;
      expect(said).toContain(
        "is claimed by another plex.tv account than yours: plex.tv says the token its claim gave it is another account's; Plex is set up, but Mediaplane can't show that it is its own, so it stays unpublished, on every apply until it can. First: if that plex.tv account is yours too",
      );
      expect(said).toContain('("docker stop mediaplane-plex-1")');
      expect(said.indexOf('afresh')).toBeGreaterThan(said.indexOf('PlexOnline'));
    }
    // Its Preferences.xml says it is claimed, so it gets no claim token.
    expect(plexTv.state.claims.filter((c) => c.account === FAKE_PLEX_ACCOUNT.id)).toEqual(
      [],
    );
    expect(published).toEqual([['plex'], ['plex']]);
    expect((await readSecretStore(home)).setUp).toBeUndefined();
    // Plex, not shown to be yours, never got your token.
    expect(
      apis.app.requests.filter(
        (r) => r.headers.host?.startsWith('plex') === true && r.headers['x-plex-token'],
      ),
    ).toEqual([]);
  });

  it('keeps a Plex unpublished, and unrecorded, whenever it does not say that no network is let in without a sign-in', async () => {
    const faults: [
      string,
      (
        | FakeReply
        | { allowedNetworks: string }
        | { enableLocalSecurity: number }
        | { dlnaEnabled: boolean }
      ),
    ][] = [
      ['a network let in', { allowedNetworks: '192.0.2.0/255.255.255.0' }],
      [
        'no allowedNetworks',
        {
          status: 200,
          body: { MediaContainer: { Setting: [{ id: 'FriendlyName', value: '' }] } },
        },
      ],
      [
        'allowedNetworks that is not text',
        {
          status: 200,
          body: { MediaContainer: { Setting: [{ id: 'allowedNetworks', value: 5 }] } },
        },
      ],
      ['local security 0', { enableLocalSecurity: 0 }],
      ['DLNA on', { dlnaEnabled: true }],
      ['a 5xx', { status: 503, body: 'fake: unavailable' }],
      ['an answer that is not settings', { status: 200, body: { nope: true } }],
    ];
    for (const [what, fault] of faults) {
      const { home, state, published, run, store } = await stepOf();
      if ('allowedNetworks' in fault) state.plex.allowedNetworks = fault.allowedNetworks;
      else if ('enableLocalSecurity' in fault)
        state.plex.enableLocalSecurity = fault.enableLocalSecurity;
      else if ('dlnaEnabled' in fault) state.plex.dlnaEnabled = fault.dlnaEnabled;
      else state.plex.prefsAnswer = fault;
      // Claimed as it first starts, yours: it stays unpublished all the same.
      const failed = await thrown(run(store));
      expect(failed, what).toBeInstanceOf(BootstrapFailed);
      expect(published, what).toEqual([['plex']]);
      expect((await readSecretStore(home)).setUp, what).toBeUndefined();
    }
  });

  it("never hands your token to Plex's setup client, which needs none", async () => {
    const { run, apis, stack, store, prefsWhenAsked, prefsAsked } = await stepOf();
    // A setup that, by mistake, asks Plex with the key its client has: none is sent.
    const index = stack.apps.findIndex((app) => app.def.id === 'plex');
    const plex = stack.apps[index] as ResolvedApp;
    const real = plex.def.bootstrap;
    if (real === undefined) throw new Error('Plex has no setup');
    stack.apps[index] = {
      ...plex,
      def: {
        ...plex.def,
        bootstrap: {
          ...real,
          run: async (api: AppApi, admin, inStack, ctx) => {
            await api.check('/library/sections').catch(() => undefined);
            return real.run(api, admin, inStack, ctx);
          },
        },
      },
    };
    await run(store);
    const toPlex = apis.app.requests.filter((r) => r.headers.host?.startsWith('plex'));
    expect(toPlex.some((r) => r.path === '/library/sections')).toBe(true);
    // Only the one read of Plex's settings carries it: nothing else of the setup's.
    expect(
      toPlex.filter((r) => r.headers['x-plex-token'] !== undefined).map((r) => r.path),
    ).toEqual(['/:/prefs']);
    // And that read comes after plex.tv has said whose Plex it is: Plex had been asked
    // for none of its settings when both of the setup's asks (yours, Plex's) started and
    // ended.
    expect(prefsWhenAsked.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(prefsWhenAsked.length).toBeGreaterThanOrEqual(4);
    expect(prefsAsked()).toBe(1);
  });

  it("asks for no claim token while Mediaplane can't read Preferences.xml, as Plex's setup can't succeed until it can", async () => {
    const { stack, ctx, plexTv } = await stepOf();
    const unreadable = [{ app: 'plex', unpublished: true }];
    // A folder where the file should be: reading it fails. The plan's
    // bootstrap.unreadable warning says what to fix.
    await mkdir(join(stack.home, 'appdata', 'plex', PLEX_PREFERENCES), {
      recursive: true,
    });
    expect(await firstStartEnv(stack, unreadable, ctx)).toEqual({});
    expect(plexTv.state.claims).toEqual([]);
    // Started published, it gets none: start variables go only with an unpublished start.
    expect(
      await firstStartEnv(stack, [{ app: 'plex', unpublished: false }], ctx),
    ).toEqual({});
  });
});
