import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { emptySecretStore, type SecretStore } from './store';
import { missingGeneratedSecrets, secretsToGenerate, secretValues } from './values';

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
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-values-'));
  await mkdir(join(home, 'secrets'));
  await writeFile(join(home, 'secrets', 'wg.key'), 'fake-wireguard-key-for-tests\n');
  const result = resolveStack(fixtureConfig(source), fixtureCatalog, FIXTURE_HOST, home);
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

const stored: SecretStore = { version: 1, apps: { sonarr: { apiKey: '0'.repeat(32) } } };

describe('missingGeneratedSecrets', () => {
  it('names the app, the secret and how to generate it', async () => {
    expect(missingGeneratedSecrets(await stackIn(), emptySecretStore())).toEqual([
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
