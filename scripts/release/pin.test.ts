import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROOT } from '../root';
import { pinnedDeployment, pinnedInstaller } from './pin';

const IMAGE = `ghcr.io/cyclopsgd/mediaplane:0.1.0@sha256:${'1'.repeat(64)}`;
const INSTALL = readFileSync(join(ROOT, 'deploy/install.sh'), 'utf8');
const DEPLOYMENT = readFileSync(join(ROOT, 'deploy/mediaplane.compose.yaml'), 'utf8');

/** The lines of `after` that differ from `before`'s, side by side. */
const changed = (before: string, after: string) => {
  const a = before.split('\n');
  const b = after.split('\n');
  expect(b).toHaveLength(a.length);
  return a.flatMap((line, i) => (line === b[i] ? [] : [[line, b[i]]]));
};

describe("a release's own deploy files", () => {
  it('name its image in install.sh, on one line, and change nothing else', () => {
    expect(changed(INSTALL, pinnedInstaller(INSTALL, IMAGE))).toEqual([
      ["release_image=''", `release_image='${IMAGE}'`],
    ]);
  });

  it("make its image mediaplane.compose.yaml's default, and change nothing else", () => {
    const pinned = pinnedDeployment(DEPLOYMENT, IMAGE);
    const lines = changed(DEPLOYMENT, pinned);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.[1]).toBe(
      `x-mediaplane-image: &mediaplane-image '\${MEDIAPLANE_IMAGE:-${IMAGE}}'`,
    );
    const deployment = parse(pinned) as {
      services: { mediaplane: { image: string; environment: Record<string, string> } };
    };
    expect(deployment.services.mediaplane.image).toBe(`\${MEDIAPLANE_IMAGE:-${IMAGE}}`);
    expect(deployment.services.mediaplane.environment.MEDIAPLANE_IMAGE).toBe(
      `\${MEDIAPLANE_IMAGE:-${IMAGE}}`,
    );
  });

  it.each([
    ['ghcr.io/cyclopsgd/mediaplane:0.1.0', 'pinned by digest'],
    [`ghcr.io/cyclopsgd/mediaplane@sha256:${'1'.repeat(64)}`, 'pinned by digest'],
    [`ghcr.io/cyclopsgd/mediaplane:0.1.0@sha256:${'1'.repeat(63)}`, 'pinned by digest'],
    [`ghcr.io/x/m:0.1.0'; rm -rf /;'@sha256:${'1'.repeat(64)}`, 'pinned by digest'],
  ])('refuse the image %s', (image, said) => {
    expect(() => pinnedInstaller(INSTALL, image)).toThrow(said);
    expect(() => pinnedDeployment(DEPLOYMENT, image)).toThrow(said);
  });

  it('refuse files that are not the ones they pin', () => {
    expect(() => pinnedInstaller('#!/bin/sh\n', IMAGE)).toThrow(
      "install.sh has no release_image='' line",
    );
    expect(() => pinnedInstaller(pinnedInstaller(INSTALL, IMAGE), IMAGE)).toThrow(
      "install.sh has no release_image='' line",
    );
    expect(() => pinnedDeployment('name: x\n', IMAGE)).toThrow(
      'mediaplane.compose.yaml has no required MEDIAPLANE_IMAGE',
    );
  });
});
