import { describe, expect, it } from 'vitest';
import { imageNode, missedSecurityReleases, type NodeRelease } from './node-security';

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
