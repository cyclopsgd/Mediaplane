import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RESOURCES_PATH } from '../paths';
import { tempDir } from '../testing/temp';
import { readResources, writeResources, type KnownResources } from './resources';

const AT = '2026-10-10T12:00:00.000Z';
const ADMIN = {
  id: null,
  name: 'admin',
  fields: { username: 'admin' },
  secrets: ['password'],
  appliedAt: AT,
};

async function homeWith(content: string): Promise<string> {
  const home = await tempDir('mediaplane-resources-');
  await mkdir(join(home, 'state'));
  await writeFile(join(home, RESOURCES_PATH), content);
  return home;
}

describe('resources.json', () => {
  it('holds nothing before the first wiring', async () => {
    expect(await readResources(await tempDir('mediaplane-resources-'))).toEqual({});
  });

  it('keeps each resource by address, sorted, private, with no secret value', async () => {
    const home = await tempDir('mediaplane-resources-');
    const resources: KnownResources = {
      'sonarr.admin': ADMIN,
      'radarr.admin': { ...ADMIN, fields: { username: 'media-admin' } },
    };
    await writeResources(home, resources);
    expect(await readResources(home)).toEqual(resources);
    const text = await readFile(join(home, RESOURCES_PATH), 'utf8');
    expect(JSON.parse(text)).toMatchObject({ schema: 'mediaplane.resources/v1' });
    expect(text.indexOf('radarr.admin')).toBeLessThan(text.indexOf('sonarr.admin'));
    expect((await stat(join(home, RESOURCES_PATH))).mode & 0o777).toBe(0o600);
    expect((await stat(join(home, 'state'))).mode & 0o777).toBe(0o700);
  });

  it('refuses a file of another schema or shape, saying where', async () => {
    const other = await homeWith(
      JSON.stringify({ schema: 'mediaplane.resources/v9', resources: {} }),
    );
    await expect(readResources(other)).rejects.toThrow(
      `${join(other, RESOURCES_PATH)} is not a Mediaplane resources file (mediaplane.resources/v1): schema:`,
    );
    const odd = await homeWith(
      JSON.stringify({ schema: 'mediaplane.resources/v1', resources: { sonarr: ADMIN } }),
    );
    await expect(readResources(odd)).rejects.toThrow('resources.sonarr:');
    // A name the contract refuses: lower case, as in ResourceSpec.name.
    const upper = await homeWith(
      JSON.stringify({
        schema: 'mediaplane.resources/v1',
        resources: { 'sonarr.Admin': ADMIN },
      }),
    );
    await expect(readResources(upper)).rejects.toThrow('resources.sonarr.Admin:');
    await expect(readResources(await homeWith('{'))).rejects.toThrow('is not valid JSON');
  });
});
