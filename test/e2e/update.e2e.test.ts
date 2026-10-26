import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeExec, type ExecResult } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { writeBundle } from '../../scripts/release/deploy-bundle';
import {
  buildImage,
  composeDown,
  docker,
  makeHome,
  publishedPort,
  removeOrIgnoreMissing,
  REPO,
  runTeardown,
  stackFor,
  TEARDOWN_MS,
} from './helpers';

/** A registry of the test's own, so that each release is pulled by digest, as from GHCR. */
const REGISTRY_IMAGE =
  'registry:3.1.2@sha256:01cd312e67026f06f5d89c3e133a4a9adc7cb9eeb9b1194e0b2954dfd770efd2';
const ID = `mediaplane-e2e-${String(process.pid)}-update`;
const STACK = ID;
const SYSTEM = `${ID}-system`;
const CONTAINER = `${ID}-mediaplane`;
const REGISTRY = `${ID}-registry`;
/** Two builds of this checkout, told apart by a label: two releases, A and B. */
const BUILDS = {
  a: `mediaplane-e2e:${String(process.pid)}-a`,
  b: `mediaplane-e2e:${String(process.pid)}-b`,
};

/**
 * What an update must leave as it is: each container of the stack (its id, image, state,
 * start time, restarts and mounts), its networks, and every file in `generated/` and
 * `state/`. The stack has no volumes of its own: every app's folders are bind mounts,
 * which each container's mounts show.
 */
interface Snapshot {
  containers: unknown[];
  networks: string[];
  files: Record<string, string>;
}

interface Inspected {
  Name: string;
  Id: string;
  Image: string;
  State: { Status: string; StartedAt: string };
  RestartCount: number;
  Mounts: { Type: string; Source: string; Destination: string; RW: boolean }[];
}

/** Every file under `dir`, by its path from `home`, with its digest. */
async function digests(home: string, dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(join(home, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(files, await digests(home, path));
    // The lock is taken and released by each command: it holds no state of the stack.
    else if (path !== 'state/lock') {
      files[path] = createHash('sha256')
        .update(await readFile(join(home, path)))
        .digest('hex');
    }
  }
  return files;
}

async function snapshot(home: string): Promise<Snapshot> {
  const label = `label=com.docker.compose.project=${STACK}`;
  const ids = (await docker('ps', '--all', '--quiet', '--filter', label))
    .split('\n')
    .filter(Boolean);
  const inspected =
    ids.length === 0 ? [] : (JSON.parse(await docker('inspect', ...ids)) as Inspected[]);
  const containers = inspected
    .map((c) => ({
      name: c.Name,
      id: c.Id,
      image: c.Image,
      status: c.State.Status,
      startedAt: c.State.StartedAt,
      restarts: c.RestartCount,
      mounts: c.Mounts.map(
        (m) => `${m.Type} ${m.Source} ${m.Destination} ${String(m.RW)}`,
      ).sort(),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  const networks = (
    await docker('network', 'ls', '--filter', label, '--format', '{{.Name}} {{.ID}}')
  ).split('\n');
  return {
    containers,
    networks: networks.sort(),
    files: { ...(await digests(home, 'generated')), ...(await digests(home, 'state')) },
  };
}

/** Now, in seconds with milliseconds, as `docker events` takes a time. */
const now = () => (Date.now() / 1000).toFixed(3);

/** The images Docker pulled between `since` and now, as `<name>@<digest>`, sorted. */
async function pulled(since: string): Promise<string[]> {
  const ids = await docker(
    'events',
    '--since',
    since,
    '--until',
    now(),
    '--filter',
    'type=image',
    '--filter',
    'event=pull',
    '--format',
    '{{.Actor.ID}}',
  );
  return [...new Set(ids.split('\n').filter(Boolean))].sort();
}

/** `name:tag@digest` as Docker names it when it pulls it: `name@digest`. */
const byDigest = (image: string) => image.replace(/:[^/:@]+@/, '@');

describe('updating Mediaplane (spec §4.4), the way deploy/README.md says', () => {
  it('pulls the next release and recreates only Mediaplane, never the stack; going back does the same', async () => {
    const home = await makeHome();
    await writeFile(
      join(home, 'stack.yaml'),
      stackFor(join(home, 'data'), { seerr: false, prowlarr: false }),
    );
    const dockerGid = String((await stat('/var/run/docker.sock')).gid);
    const bundles = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-bundles-'));
    const override = join(bundles, 'override.yaml');
    await writeFile(
      override,
      [
        'services:',
        '  mediaplane:',
        `    container_name: ${CONTAINER}`,
        '    environment:',
        `      MEDIAPLANE_COMPOSE_PROJECT: ${STACK}`,
        '',
      ].join('\n'),
    );
    // As a user deploys it: no MEDIAPLANE_IMAGE, since the release's file names its own.
    const env: NodeJS.ProcessEnv = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('MEDIAPLANE_')),
    );
    Object.assign(env, {
      MEDIAPLANE_HOME: home,
      MEDIAPLANE_UID: String(process.getuid?.() ?? 1000),
      MEDIAPLANE_GID: String(process.getgid?.() ?? 1000),
      DOCKER_GID: dockerGid,
    });
    const pushed: string[] = [];
    /** `docker compose pull` then `up -d`, with a release's own deploy files. */
    const system = async (
      release: string,
      args: readonly string[],
    ): Promise<ExecResult> =>
      nodeExec(
        'docker',
        [
          'compose',
          '-p',
          SYSTEM,
          '--env-file',
          '/dev/null',
          '-f',
          join(bundles, release, 'mediaplane', 'deploy', 'mediaplane.compose.yaml'),
          '-f',
          override,
          ...args,
        ],
        { env, cwd: '/', timeoutMs: 300_000 },
      );
    /** Pull, then up -d; Docker must pull only the release's image and the proxy's. */
    const deploy = async (release: string) => {
      const since = now();
      for (const args of [['pull'], ['up', '-d', '--wait']]) {
        const result = await system(release, args);
        expect(result.code, `${args.join(' ')}: ${result.stderr}`).toBe(0);
      }
      const file = join(
        bundles,
        release,
        'mediaplane',
        'deploy',
        'mediaplane.compose.yaml',
      );
      const services = (
        parse(await readFile(file, 'utf8')) as {
          services: Record<string, { image: string }>;
        }
      ).services;
      const proxy = services['socket-proxy']?.image ?? '';
      expect(await pulled(since)).toEqual(
        [byDigest(releases[release]?.image ?? ''), byDigest(proxy)].sort(),
      );
    };
    const mediaplane = (...args: string[]) =>
      nodeExec('docker', ['exec', CONTAINER, 'mediaplane', ...args], {
        cwd: '/',
        timeoutMs: 900_000,
      });
    const running = async () => docker('inspect', '--format', '{{.Image}}', CONTAINER);
    const releases: Record<string, { image: string; id: string }> = {};
    try {
      await docker(
        'run',
        '--detach',
        '--name',
        REGISTRY,
        '--label',
        'io.mediaplane.e2e=update',
        '--publish',
        '127.0.0.1::5000',
        REGISTRY_IMAGE,
      );
      const port = await publishedPort(REGISTRY, '5000/tcp');
      // Two releases, each pushed, and its deploy files pinned to its digest.
      for (const [name, tag] of Object.entries(BUILDS)) {
        await buildImage(tag, ['--label', `io.mediaplane.e2e.release=${name}`]);
        const remote = `127.0.0.1:${String(port)}/mediaplane-e2e:${String(process.pid)}-${name}`;
        await docker('tag', tag, remote);
        pushed.push(remote);
        await docker('push', '--quiet', remote);
        const digest =
          (
            await docker(
              'image',
              'inspect',
              '--format',
              '{{index .RepoDigests 0}}',
              remote,
            )
          ).split('@')[1] ?? '';
        const image = `${remote}@${digest}`;
        releases[name] = {
          image,
          id: await docker('image', 'inspect', '--format', '{{.Id}}', tag),
        };
        await writeBundle({
          root: REPO,
          out: join(bundles, name),
          version: name === 'a' ? '0.0.1' : '0.0.2',
          image,
          epoch: 0,
        });
        const tar = await nodeExec(
          'tar',
          [
            '--extract',
            '--file',
            join(
              bundles,
              name,
              `mediaplane-deploy-${name === 'a' ? '0.0.1' : '0.0.2'}.tar.gz`,
            ),
            '--directory',
            join(bundles, name),
          ],
          { cwd: '/' },
        );
        expect(tar.code, tar.stderr).toBe(0);
      }
      expect(releases.a?.id).not.toBe(releases.b?.id);

      // Release A, then the stack it applies.
      await deploy('a');
      expect(await running()).toBe(releases.a?.id);
      const applied = await mediaplane('apply', '--yes');
      expect(applied.code, applied.stderr).toBe(0);
      const before = await snapshot(home);
      expect(before.containers.length).toBeGreaterThan(0);
      expect(
        before.containers.every((c) => (c as { status: string }).status === 'running'),
      ).toBe(true);

      // The update: release B's deploy files, pull, up -d.
      await deploy('b');
      expect(await running()).toBe(releases.b?.id);
      expect(await snapshot(home)).toEqual(before);
      // Mediaplane B finds the stack as A left it, and pulls nothing to look.
      const looked = now();
      const planned = await mediaplane('plan');
      expect(planned.code, `${planned.stdout}${planned.stderr}`).toBe(0);
      expect(await pulled(looked)).toEqual([]);
      expect(await snapshot(home)).toEqual(before);

      // Going back to A is the same, with A's deploy files.
      await deploy('a');
      expect(await running()).toBe(releases.a?.id);
      expect(await snapshot(home)).toEqual(before);
      const again = await mediaplane('plan');
      expect(again.code, `${again.stdout}${again.stderr}`).toBe(0);
    } finally {
      await runTeardown([
        // Mediaplane's project first: it takes Mediaplane off the stack's network.
        async () => {
          const down = await nodeExec(
            'docker',
            ['compose', '-p', SYSTEM, 'down', '--remove-orphans'],
            { cwd: '/', timeoutMs: TEARDOWN_MS },
          );
          if (down.code !== 0) throw new Error(down.stderr);
        },
        async () => {
          const down = await composeDown(STACK);
          if (down.code !== 0) throw new Error(down.stderr);
        },
        () => removeOrIgnoreMissing('rm', '--force', '--volumes', REGISTRY),
        ...[...pushed, ...Object.values(BUILDS)].map(
          (image) => () => removeOrIgnoreMissing('image', 'rm', image),
        ),
        () => rm(bundles, { recursive: true, force: true }),
      ]);
    }
  }, 1_800_000);
});
