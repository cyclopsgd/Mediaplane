import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_HOST, fixtureCatalog } from '../testing/fixtures';
import { COMPOSE_PATH, plan } from './plan';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  qbittorrent: {}
  sonarr: {}
`;

async function makeHome({ stack = STACK, withSecret = true } = {}): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-plan-'));
  await writeFile(join(home, 'stack.yaml'), stack);
  if (withSecret) {
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'wg.key'), 'fake-wireguard-key-for-tests\n');
  }
  return home;
}

const planFor = (home: string) =>
  plan({ home, catalog: fixtureCatalog, host: FIXTURE_HOST, env: {} });

describe('plan', () => {
  it('plans to create compose.yaml in a fresh home', async () => {
    const result = await planFor(await makeHome());
    expect(result).toMatchObject({ ok: true, changed: true, diagnostics: [] });
    expect(result.files).toEqual([
      expect.objectContaining({ path: COMPOSE_PATH, status: 'create' }),
    ]);
    expect(result.files[0]?.content).toContain('name: mediaplane');
  });

  it('reports no changes when compose.yaml is already current', async () => {
    const home = await makeHome();
    const first = await planFor(home);
    await mkdir(join(home, 'generated'));
    await writeFile(join(home, COMPOSE_PATH), first.files[0]?.content ?? '');
    expect(await planFor(home)).toMatchObject({
      ok: true,
      changed: false,
      files: [{ status: 'unchanged' }],
    });
  });

  it('fails with the config error when stack.yaml is missing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-plan-'));
    expect(await planFor(home)).toMatchObject({
      ok: false,
      changed: false,
      files: [],
      diagnostics: [{ code: 'config.missing' }],
    });
  });

  it('fails when a referenced secret is missing', async () => {
    expect(await planFor(await makeHome({ withSecret: false }))).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({ code: 'secret.missing', path: 'vpn.private_key' }),
      ],
    });
  });

  it('fails when the stack does not resolve', async () => {
    const stack = STACK.replace('  qbittorrent: {}\n', '');
    expect(await planFor(await makeHome({ stack }))).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'app.missing-capability' })],
    });
  });
});
