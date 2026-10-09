import { describe, expect, it } from 'vitest';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { emptySecretStore } from './store';
import { generateSecret, withGeneratedSecrets, type RandomBytes } from './generate';

const constant =
  (byte: number): RandomBytes =>
  (size) =>
    Buffer.alloc(size, byte);

function stackOf(source: string): ResolvedStack {
  const result = resolveStack(
    fixtureConfig(source),
    fixtureCatalog,
    FIXTURE_HOST,
    '/opt/mediaplane',
  );
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  qbittorrent: { vpn: false }
  sonarr: {}
`;

describe('generateSecret', () => {
  it('makes 32 hex characters from 16 random bytes', () => {
    expect(generateSecret('hex32', constant(0xab))).toBe('ab'.repeat(16));
  });

  it("makes qBittorrent's qbt_ key from base62 characters", () => {
    // 171 % 62 = 47, which is "l" in 0-9A-Za-z.
    expect(generateSecret('qbt', constant(171))).toBe(`qbt_${'l'.repeat(28)}`);
  });

  it('discards bytes that would bias the base62 alphabet', () => {
    let call = 0;
    const random: RandomBytes = (size) => Buffer.alloc(size, call++ === 0 ? 0xff : 0x00);
    expect(generateSecret('qbt', random)).toBe(`qbt_${'0'.repeat(28)}`);
  });

  it('uses real randomness by default', () => {
    expect(generateSecret('hex32')).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSecret('qbt')).toMatch(/^qbt_[0-9A-Za-z]{28}$/);
    expect(generateSecret('hex32')).not.toBe(generateSecret('hex32'));
  });
});

describe('withGeneratedSecrets', () => {
  it('fills in missing generated secrets and lists them', () => {
    const result = withGeneratedSecrets(
      stackOf(STACK),
      emptySecretStore(),
      constant(0xab),
    );
    expect(result.generated).toEqual(['sonarr.apiKey']);
    expect(result.store).toEqual({
      version: 1,
      apps: { sonarr: { apiKey: 'ab'.repeat(16) } },
    });
  });

  it('never replaces a secret that already exists', () => {
    const existing = {
      version: 1 as const,
      apps: { sonarr: { apiKey: '0'.repeat(32) } },
    };
    const result = withGeneratedSecrets(stackOf(STACK), existing, constant(0xab));
    expect(result).toEqual({ store: existing, generated: [] });
  });
});
