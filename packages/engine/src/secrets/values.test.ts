import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import {
  FIXTURE_API,
  FIXTURE_HOST,
  fixtureCatalog,
  fixtureConfig,
} from '../testing/fixtures';
import { emptySecretStore, type SecretStore } from './store';
import {
  givenKeys,
  missingGeneratedSecrets,
  secretsToGenerate,
  secretValues,
  stackKeys,
  userSecrets,
} from './values';
import { tempDir } from '../testing/temp';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  qbittorrent: {}
  sonarr: { env: { TOKEN: { env: FAKE_TOKEN_VAR } } }
`;

/**
 * Gluetun's credential variable (MP_GLUETUN_WIREGUARD_KEY) is inserted before its env
 * reference (MP_GLUETUN_ENV_FAKE_EXTRA) but sorts after it, so insertion order differs
 * from sorted order.
 */
const STACK_WITH_GLUETUN_ENV = `${STACK}  gluetun: { env: { FAKE_EXTRA: { env: FAKE_EXTRA_VAR } } }\n`;

async function stackIn(source = STACK): Promise<ResolvedStack> {
  const home = await tempDir('mediaplane-values-');
  await mkdir(join(home, 'secrets'));
  await writeFile(join(home, 'secrets', 'wg.key'), 'fake-wireguard-key-for-tests\n');
  const result = resolveStack(fixtureConfig(source), fixtureCatalog, FIXTURE_HOST, home);
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

const stored: SecretStore = {
  version: 1,
  apps: {
    gluetun: { controlApiKey: '1'.repeat(32) },
    sonarr: { apiKey: '0'.repeat(32) },
  },
  shared: { adminPassword: 'fake-admin-password' },
};

describe('missingGeneratedSecrets', () => {
  it('names the app, the secret and how to generate it', async () => {
    expect(missingGeneratedSecrets(await stackIn(), emptySecretStore())).toEqual([
      { app: 'gluetun', name: 'controlApiKey', kind: 'hex32' },
      { app: 'sonarr', name: 'apiKey', kind: 'hex32' },
    ]);
  });

  it('is empty once the store has them', async () => {
    expect(missingGeneratedSecrets(await stackIn(), stored)).toEqual([]);
  });
});

describe('secretsToGenerate', () => {
  it('lists generated secrets that are not in the store yet', async () => {
    expect(secretsToGenerate(await stackIn(), emptySecretStore())).toEqual([
      'admin.password',
      'gluetun.controlApiKey',
      'sonarr.apiKey',
    ]);
  });

  it('is empty once the store has them', async () => {
    expect(secretsToGenerate(await stackIn(), stored)).toEqual([]);
  });
});

describe('secretValues', () => {
  it('collects every referenced variable, with "" for unknown values', async () => {
    expect(await secretValues(await stackIn(), emptySecretStore(), {})).toEqual({
      MP_GLUETUN_WIREGUARD_KEY: 'fake-wireguard-key-for-tests',
      MP_SONARR_API_KEY: '',
      MP_SONARR_ENV_TOKEN: '',
    });
  });

  it('takes generated secrets from the store and env references from the environment', async () => {
    const values = await secretValues(await stackIn(), stored, {
      FAKE_TOKEN_VAR: 'fake-token-value',
    });
    expect(values).toMatchObject({
      MP_SONARR_API_KEY: '0'.repeat(32),
      MP_SONARR_ENV_TOKEN: 'fake-token-value',
    });
    expect(Object.keys(values)).toEqual([...Object.keys(values)].sort());
  });

  it('sorts keys even when they were collected out of order', async () => {
    const values = await secretValues(await stackIn(STACK_WITH_GLUETUN_ENV), stored, {
      FAKE_EXTRA_VAR: 'fake-extra-value',
    });
    expect(Object.keys(values)).toEqual([
      'MP_GLUETUN_ENV_FAKE_EXTRA',
      'MP_GLUETUN_WIREGUARD_KEY',
      'MP_SONARR_API_KEY',
      'MP_SONARR_ENV_TOKEN',
    ]);
    expect(values.MP_GLUETUN_ENV_FAKE_EXTRA).toBe('fake-extra-value');
  });
});

describe('userSecrets and stackKeys', () => {
  it("reads every secret you give, by app, and adds to the stored keys only an app's API key", async () => {
    const stack = await stackIn();
    const given = await userSecrets(stack, {});
    // Every one is read, so that it is redacted: the VPN key too.
    expect(given).toEqual({ gluetun: { wireguardKey: 'fake-wireguard-key-for-tests' } });
    // No app's API takes the VPN key, so no setup or resource gets it.
    expect(stackKeys(stack, stored, given)).toEqual(stored.apps);
    // One an app's API takes as its key, as Plex's takes your token, is a key.
    const keyed: ResolvedStack = {
      ...stack,
      apps: stack.apps.map((app) =>
        app.def.id === 'gluetun'
          ? {
              ...app,
              def: {
                ...app.def,
                api: {
                  port: 'control',
                  ready: '/',
                  key: { secret: 'wireguardKey', scheme: 'x-api-key' },
                  check: '/',
                },
              },
            }
          : app,
      ),
    };
    expect(stackKeys(keyed, stored, given)).toEqual({
      gluetun: {
        controlApiKey: '1'.repeat(32),
        wireguardKey: 'fake-wireguard-key-for-tests',
      },
      sonarr: { apiKey: '0'.repeat(32) },
    });
    // The store itself is left as it was: what you give is never saved in it.
    expect(stored.apps.gluetun).toEqual({ controlApiKey: '1'.repeat(32) });
  });

  it('leaves out one that is missing', async () => {
    const stack = await stackIn(STACK.replace('secrets/wg.key', 'secrets/none.key'));
    expect(await userSecrets(stack, {})).toEqual({});
  });
});

describe('givenKeys', () => {
  it("gives only the secrets you give that an app's API takes as its key", async () => {
    const stack = await stackIn();
    const catalog = fixtureCatalog.map((app) =>
      app.id === 'gluetun'
        ? {
            ...app,
            api: {
              ...FIXTURE_API,
              key: { secret: 'wireguardKey', scheme: 'x-api-key' as const },
            },
          }
        : app,
    );
    const keyed = resolveStack(fixtureConfig(STACK), catalog, FIXTURE_HOST, stack.home);
    if (keyed.stack === undefined) throw new Error('the stack did not resolve');
    const given = { gluetun: { wireguardKey: 'fake-key', other: 'fake-other' } };
    expect(givenKeys(keyed.stack, given)).toEqual({
      gluetun: { wireguardKey: 'fake-key' },
    });
    // Without an API that takes it, the VPN key reaches no setup.
    expect(givenKeys(stack, given)).toEqual({});
  });
});
