import { catalog } from '@mediaplane/catalog';
import type { Exec } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { pinnedImage } from './catalog-images';
import { PRE_PULL_DELAYS_MS, pullWithRetries, suiteImages } from './pull-images';

describe('suiteImages', () => {
  it("lists the catalog's images for the architecture, and every image the suite pins", () => {
    const images = suiteImages('arm64');
    for (const def of catalog.filter((d) => d.arch.includes('arm64'))) {
      expect(images).toContain(pinnedImage(def));
    }
    for (const name of [
      'busybox:',
      'lscr.io/linuxserver/wireguard:',
      'registry:',
      'node:',
      'docker:',
      'wollomatic/socket-proxy:',
    ]) {
      expect(
        images.some((image) => image.startsWith(name)),
        name,
      ).toBe(true);
    }
    expect(images).toEqual([...new Set(images)].sort());
    for (const image of images) expect(image).toMatch(/@sha256:[0-9a-f]{64}$/);
  });
});

describe('pullWithRetries', () => {
  /** An exec whose docker pull answers each of `answers` in turn: an error, or success. */
  function pulls(answers: (string | undefined)[]) {
    const calls: string[][] = [];
    const exec: Exec = (command, args) => {
      calls.push([command, ...args]);
      const error = answers.shift();
      return Promise.resolve(
        error === undefined
          ? { code: 0, stdout: '', stderr: '' }
          : { code: 1, stdout: '', stderr: error },
      );
    };
    const slept: number[] = [];
    const sleep = (ms: number) => {
      slept.push(ms);
      return Promise.resolve();
    };
    return { exec, sleep, calls, slept };
  }

  const LIMITED = 'toomanyrequests: You have reached your pull rate limit.';

  it('pulls again after a temporary registry error, waiting longer than apply does', async () => {
    const { exec, sleep, calls, slept } = pulls([
      LIMITED,
      'net/http: TLS handshake timeout',
    ]);
    expect(await pullWithRetries('busybox:1@sha256:fake', exec, sleep)).toEqual({
      ok: true,
      retries: 2,
    });
    expect(calls[0]).toEqual(['docker', 'pull', '--quiet', 'busybox:1@sha256:fake']);
    expect(slept).toEqual([15_000, 30_000]);
  });

  it('fails at once for what waiting will not fix', async () => {
    const { exec, sleep, slept } = pulls(['manifest unknown: manifest unknown']);
    expect(await pullWithRetries('busybox:1@sha256:fake', exec, sleep)).toEqual({
      ok: false,
      error: 'manifest unknown: manifest unknown',
    });
    expect(slept).toEqual([]);
  });

  it('gives up after its last wait, with the last error', async () => {
    const { exec, sleep, calls, slept } = pulls(
      Array.from({ length: 10 }, () => LIMITED),
    );
    expect(await pullWithRetries('busybox:1@sha256:fake', exec, sleep)).toEqual({
      ok: false,
      error: LIMITED,
    });
    expect(slept).toEqual(PRE_PULL_DELAYS_MS);
    expect(calls).toHaveLength(PRE_PULL_DELAYS_MS.length + 1);
  });
});
