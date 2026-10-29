import { describe, expect, it, vi } from 'vitest';
import {
  fetchIndex,
  imageNode,
  missedSecurityReleases,
  NODE_INDEX,
  parseIndex,
  type NodeRelease,
} from './node-security';

const FROM = (version: string) => `node:${version}-alpine3.24@sha256:${'0'.repeat(64)}`;
const dockerfile = (...versions: string[]) =>
  versions
    .map(
      (v, i) =>
        `FROM ${i === 0 ? '--platform=$BUILDPLATFORM ' : ''}${FROM(v)}${i === 0 ? ' AS bundle' : ''}\n`,
    )
    .join('RUN true\n');

// Node's own release index, newest first, as https://nodejs.org/dist/index.json lists it.
const INDEX: NodeRelease[] = [
  { version: 'v25.1.0', security: true },
  { version: 'v24.22.1', security: true },
  { version: 'v24.22.0', security: false },
  { version: 'v24.21.0', security: false },
  { version: 'v24.18.1', security: true },
  { version: 'v22.30.0', security: true },
];

describe('imageNode', () => {
  it("reads the Node version of the image's base", () => {
    expect(imageNode(dockerfile('24.21.0', '24.21.0'))).toBe('24.21.0');
  });

  it('refuses a Dockerfile whose Node bases differ, or that has none', () => {
    expect(() => imageNode(dockerfile('24.21.0', '24.22.1'))).toThrow(
      'the Dockerfile builds on more than one Node: 24.21.0, 24.22.1',
    );
    expect(() => imageNode('FROM alpine:3.24\n')).toThrow('no node:<version> base');
  });
});

describe('missedSecurityReleases', () => {
  it('names the security releases of its line newer than the image has', () => {
    expect(missedSecurityReleases('24.21.0', INDEX)).toEqual(['24.22.1']);
  });

  it('is empty once the image has the newest one', () => {
    expect(missedSecurityReleases('24.22.1', INDEX)).toEqual([]);
  });

  it("doesn't count another major line, or a release that fixed nothing", () => {
    expect(missedSecurityReleases('24.22.0', INDEX)).toEqual(['24.22.1']);
    expect(missedSecurityReleases('22.30.0', INDEX)).toEqual([]);
  });

  it('refuses an index that lists none of its line: a check that saw nothing passes nothing', () => {
    expect(() =>
      missedSecurityReleases('24.21.0', [{ version: 'v22.30.0', security: true }]),
    ).toThrow("Node's release index lists no 24.x release");
  });
});

describe('parseIndex', () => {
  it('reads the version and the security flag, and ignores the rest', () => {
    expect(
      parseIndex([
        { version: 'v24.22.1', date: '2026-10-20', lts: 'Krypton', security: true },
      ]),
    ).toEqual([{ version: 'v24.22.1', security: true }]);
  });

  it('skips a pre-release, which no image is built on, and keeps the releases', () => {
    // nodejs.org listed v27.0.0-alpha.0.0.0 on 2026-10-29.
    expect(
      parseIndex([
        { version: 'v27.0.0-alpha.0.0.0', security: false },
        { version: 'v24.23.0-rc.1', security: true },
        { version: 'v24.22.1', security: true },
      ]),
    ).toEqual([{ version: 'v24.22.1', security: true }]);
  });

  it.each([
    ['an object', { version: 'v24.22.1', security: true }],
    ['null', null],
    ['an item that is not an object', ['v24.22.1']],
    ['a null item', [null]],
    ['a release without the flag', [{ version: 'v24.22.1' }]],
    ['a flag that is not a boolean', [{ version: 'v24.22.1', security: 'true' }]],
    ['a release without a version', [{ security: true }]],
    ['a version that is not v<n>.<n>.<n>', [{ version: '24.22.1', security: true }]],
    ['a version with two numbers', [{ version: 'v24.22', security: true }]],
    ['an empty pre-release', [{ version: 'v24.22.1-', security: true }]],
    ['a version with a space', [{ version: 'v24.22.1 beta', security: true }]],
    [
      'a pre-release with an empty part',
      [{ version: 'v27.0.0-alpha..1', security: true }],
    ],
  ])('refuses %s: a check that read nothing passes nothing', (_, json) => {
    expect(() => parseIndex(json)).toThrow("Node's release index is not a list of");
  });
});

describe('fetchIndex', () => {
  const ok = (json: unknown) => ({ ok: true, json: () => Promise.resolve(json) });
  const stub = (...answers: unknown[]) => {
    const calls = vi.fn();
    const queue = [...answers];
    const fetchJson = (...args: unknown[]) => {
      calls(...args);
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    };
    return { calls, fetchJson: fetchJson as unknown as typeof fetch };
  };
  const NONE = [0, 0, 0];

  it('returns the index it reads', async () => {
    const { calls, fetchJson } = stub(ok(INDEX));
    await expect(fetchIndex(fetchJson, NONE)).resolves.toEqual(INDEX);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(calls.mock.calls[0]?.[0]).toBe(NODE_INDEX);
  });

  it('tries again after an error, and after a status that is not OK', async () => {
    const { calls, fetchJson } = stub(
      new Error('network down'),
      { ok: false, status: 503 },
      ok(INDEX),
    );
    await expect(fetchIndex(fetchJson, NONE)).resolves.toEqual(INDEX);
    expect(calls).toHaveBeenCalledTimes(3);
  });

  it("fails, saying why, when it can't read the index three times", async () => {
    const { calls, fetchJson } = stub({ ok: false, status: 503 });
    await expect(fetchIndex(fetchJson, NONE)).rejects.toThrow(
      `couldn't read ${NODE_INDEX}: HTTP 503`,
    );
    expect(calls).toHaveBeenCalledTimes(3);
    const down = stub(new Error('network down'));
    await expect(fetchIndex(down.fetchJson, NONE)).rejects.toThrow(
      `couldn't read ${NODE_INDEX}: network down`,
    );
  });

  it('tries again when the body is not JSON', async () => {
    const broken = {
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    };
    const { calls, fetchJson } = stub(broken, ok(INDEX));
    await expect(fetchIndex(fetchJson, NONE)).resolves.toEqual(INDEX);
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('fails at once on an index of another shape', async () => {
    const { calls, fetchJson } = stub(ok([{ version: 'v24.22.1' }]));
    await expect(fetchIndex(fetchJson, NONE)).rejects.toThrow(
      "Node's release index is not a list of",
    );
    expect(calls).toHaveBeenCalledTimes(1);
  });
});
