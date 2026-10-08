import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from './load';
import type { StackConfig } from './schema';
import { checkSecretRefs, readSecret, secretRefs } from './secrets';

async function homeWith(files: Record<string, string>): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-secrets-'));
  await mkdir(join(home, 'secrets'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(home, 'secrets', name), content);
  }
  return home;
}

function configWith(extra: string): StackConfig {
  const result = parseConfig(
    `version: 1\npaths: { data: /srv/data }\nmedia_server: jellyfin\n${extra}`,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.config;
}

describe('readSecret', () => {
  it('reads and trims a file relative to the home directory', async () => {
    const home = await homeWith({ 'wg.key': 'fake-key\n' });
    expect(await readSecret({ file: 'secrets/wg.key' }, home, {})).toBe('fake-key');
  });

  it('reads absolute paths as they are', async () => {
    const home = await homeWith({ 'wg.key': 'fake-key' });
    const file = join(home, 'secrets', 'wg.key');
    expect(await readSecret({ file }, '/elsewhere', {})).toBe('fake-key');
  });

  it('treats missing and empty files as absent', async () => {
    const home = await homeWith({ empty: '  \n' });
    expect(await readSecret({ file: 'secrets/nope' }, home, {})).toBeUndefined();
    expect(await readSecret({ file: 'secrets/empty' }, home, {})).toBeUndefined();
  });

  it('reads environment variables', async () => {
    const env = { VPN_KEY: ' fake-env-key ' };
    expect(await readSecret({ env: 'VPN_KEY' }, '/', env)).toBe('fake-env-key');
    expect(await readSecret({ env: 'VPN_KEY' }, '/', {})).toBeUndefined();
  });
});

describe('secretRefs and checkSecretRefs', () => {
  const config = configWith(
    'admin: { password: { env: ADMIN_PASSWORD } }\n' +
      'vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }\n',
  );

  it('finds every secret reference, in a fixed order', () => {
    expect(secretRefs(config).map((r) => r.path)).toEqual([
      'admin.password',
      'vpn.private_key',
    ]);
  });

  it('reports each missing secret with its stack.yaml path', async () => {
    expect(await checkSecretRefs(config, await homeWith({}), {})).toEqual([
      expect.objectContaining({ code: 'secret.missing', path: 'admin.password' }),
      expect.objectContaining({ code: 'secret.missing', path: 'vpn.private_key' }),
    ]);
  });

  it('is quiet when every secret resolves', async () => {
    const home = await homeWith({ 'wg.key': 'fake-key' });
    expect(
      await checkSecretRefs(config, home, { ADMIN_PASSWORD: 'fake-password' }),
    ).toEqual([]);
  });
});
