import { describe, expect, it } from 'vitest';
import { ownImage, ownName, SERVARR_FAILURE_MAX, servarrFailure } from './helpers';

const KEY = 'f'.repeat(32);

/** An arr's answer of validation errors, as Sonarr gives one. */
function refused(errors: { propertyName: string; errorMessage: string }[]): Response {
  return new Response(JSON.stringify(errors), { status: 400 });
}

describe('servarrFailure', () => {
  it("gives an arr's own words on one short line, with no secret", async () => {
    const said = await servarrFailure(
      refused([
        { propertyName: 'ApiKey', errorMessage: `Unable to connect\nwith ${KEY}` },
        { propertyName: 'Host', errorMessage: 'x'.repeat(400) },
      ]),
      [KEY],
    );
    expect(said).not.toContain(KEY);
    expect(said).not.toContain('\n');
    expect(
      said.startsWith('status 400: ApiKey: Unable to connect with ***; Host: x'),
    ).toBe(true);
    expect(said.length).toBe('status 400: '.length + SERVARR_FAILURE_MAX + 1);
    expect(said.endsWith('…')).toBe(true);
  });

  it('leaves a short answer whole', async () => {
    expect(
      await servarrFailure(
        refused([{ propertyName: 'Path', errorMessage: 'Invalid' }]),
        [],
      ),
    ).toBe('status 400: Path: Invalid');
  });
});

describe('ownName', () => {
  it("is this worker's project, its containers and networks, and no other worker's", () => {
    const prefix = 'mediaplane-e2e-123';
    for (const name of [
      prefix,
      `${prefix}-vpn`,
      `${prefix}_wiring`,
      `${prefix}-vpn-system`,
    ]) {
      expect(ownName(name, prefix), name).toBe(true);
    }
    for (const name of [
      'mediaplane-e2e-1234',
      'mediaplane',
      'other-mediaplane-e2e-123',
    ]) {
      expect(ownName(name, prefix), name).toBe(false);
    }
  });
});

describe('ownImage', () => {
  const prefix = 'mediaplane-e2e-123';

  it("is the tags this worker's tests build, and no other image or tag", () => {
    for (const image of [
      'mediaplane-e2e:123',
      'mediaplane-e2e:123-vpn',
      'mediaplane-e2e:123-a',
      '127.0.0.1:49152/mediaplane-e2e:123-b',
    ]) {
      expect(ownImage(image, prefix), image).toBe(true);
    }
    for (const image of [
      'mediaplane-e2e:1234',
      'mediaplane-e2e:1234-vpn',
      'mediaplane-e2e:latest',
      'mediaplane-e2e:<none>',
      'mediaplane:123',
      'other/mediaplane-e2e:123',
      'registry.example/mediaplane-e2e:123',
      'busybox:123',
      'busybox:1.37.0',
    ]) {
      expect(ownImage(image, prefix), image).toBe(false);
    }
  });
});
