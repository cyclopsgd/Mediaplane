import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  composeToYaml,
  createDockerRuntime,
  detectHostFacts,
  nodeExec,
  nodeProbe,
  plan,
  predictContainers,
  type ComposeFile,
  type ExecResult,
} from '@mediaplane/engine';
import { tempDir } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { BUSYBOX, composeDown, makeHome } from './helpers';

const PROJECT = `mediaplane-e2e-${process.pid}`;

/** `docker compose create` for the compose.yaml in `home`, as `project`. */
function composeCreate(
  project: string,
  home: string,
  values: Record<string, string> = {},
): Promise<ExecResult> {
  return nodeExec(
    'docker',
    [
      'compose',
      '-p',
      project,
      '--project-directory',
      home,
      '-f',
      join(home, 'compose.yaml'),
      'create',
    ],
    { env: { ...process.env, ...values }, cwd: '/' },
  );
}

function planFor(home: string) {
  return plan({
    home,
    catalog,
    host: detectHostFacts(),
    env: process.env,
    runtime: createDockerRuntime({ home, project: PROJECT }),
    probe: nodeProbe,
  });
}

describe('plan against real Docker', () => {
  it('plans the whole video stack, accepted by Compose', async () => {
    const result = await planFor(await makeHome());
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.containers.map((c) => [c.service, c.action])).toEqual([
      ['byparr', 'create'],
      ['jellyfin', 'create'],
      ['prowlarr', 'create'],
      ['qbittorrent', 'create'],
      ['radarr', 'create'],
      ['seerr', 'create'],
      ['sonarr', 'create'],
    ]);
    expect(result.secrets.generate).toEqual([
      'admin.password',
      'prowlarr.apiKey',
      'qbittorrent.apiKey',
      'radarr.apiKey',
      'seerr.apiKey',
      'sonarr.apiKey',
    ]);
    expect(
      result.files.filter((f) => f.prestart === true).map((f) => [f.path, f.status]),
    ).toEqual([
      ['appdata/prowlarr/config.xml', 'create'],
      ['appdata/qbittorrent/qBittorrent/qBittorrent.conf', 'create'],
      ['appdata/radarr/config.xml', 'create'],
      ['appdata/sonarr/config.xml', 'create'],
    ]);
  });

  it("includes the user's compose.override.yaml in the hashes", async () => {
    const home = await makeHome();
    const compose = (await planFor(home)).files[0]?.content ?? '';
    const runtime = createDockerRuntime({ home, project: PROJECT });
    const before = await runtime.configHashes(compose, {});
    await writeFile(
      join(home, 'compose.override.yaml'),
      'services:\n  sonarr:\n    environment:\n      FAKE_EXTRA: "1"\n',
    );
    const after = await runtime.configHashes(compose, {});
    if (!before.ok || !after.ok) throw new Error('compose rejected the configuration');
    expect(after.hashes.sonarr).not.toBe(before.hashes.sonarr);
    expect(after.hashes.radarr).toBe(before.hashes.radarr);
    expect((await planFor(home)).ok).toBe(true);
  });

  it('predicts the config hash Compose records on the container it creates', async () => {
    const home = await tempDir('mediaplane-e2e-');
    const compose = [
      'services:',
      '  probe:',
      `    image: ${BUSYBOX}`,
      '    command: ["true"]',
      '    environment:',
      '      FAKE_SECRET: "${MP_FAKE_SECRET}"',
      '',
    ].join('\n');
    const values = { MP_FAKE_SECRET: 'fake-secret-value' };
    // Its own project, so a failed clean-up can't leak into the other tests' plans.
    const project = `${PROJECT}-hash`;
    const runtime = createDockerRuntime({ home, project });
    const predicted = await runtime.configHashes(compose, values);
    await writeFile(join(home, 'compose.yaml'), compose);
    try {
      const created = await composeCreate(project, home, values);
      expect(created.code, created.stderr).toBe(0);
      const containers = await runtime.containers();
      expect(containers).toEqual([
        expect.objectContaining({ service: 'probe', state: 'created', published: [] }),
      ]);
      expect(predicted).toEqual({
        ok: true,
        hashes: { probe: containers[0]?.configHash },
      });
    } finally {
      await composeDown(project);
    }
  });

  it("predicts a guest in another service's network namespace", async () => {
    const home = await tempDir('mediaplane-e2e-');
    const project = `${PROJECT}-ns`;
    // ComposeService has no command: these containers are only created, never started,
    // so busybox's default command doesn't matter. The name matches -p as well.
    const compose = (aEnvironment?: Record<string, string>): ComposeFile => ({
      name: project,
      services: {
        a: {
          image: BUSYBOX,
          restart: 'unless-stopped',
          ...(aEnvironment === undefined ? {} : { environment: aEnvironment }),
          labels: {},
        },
        b: {
          image: BUSYBOX,
          restart: 'unless-stopped',
          network_mode: 'service:a',
          labels: {},
        },
      },
    });
    const runtime = createDockerRuntime({ home, project });
    const predict = async (file: ComposeFile) =>
      predictContainers(file, {}, runtime, await runtime.containers());
    let down: ExecResult | undefined;
    try {
      await writeFile(join(home, 'compose.yaml'), composeToYaml(compose()));
      const created = await composeCreate(project, home);
      expect(created.code, created.stderr).toBe(0);
      // `create` leaves both containers "created" with matching hashes: up would only
      // start them. Without the guest pass, b would show as recreate.
      expect(await predict(compose())).toEqual({
        ok: true,
        changes: [
          { service: 'a', action: 'start' },
          { service: 'b', action: 'start' },
        ],
      });

      // Change only a: Compose recreates b with it, in a's new network namespace.
      const changed = compose({ FAKE_CHANGE: '1' });
      expect(await predict(changed)).toEqual({
        ok: true,
        changes: [
          { service: 'a', action: 'recreate' },
          { service: 'b', action: 'recreate' },
        ],
      });
      const before = await runtime.containers();
      expect(before).toHaveLength(2);
      await writeFile(join(home, 'compose.yaml'), composeToYaml(changed));
      const recreated = await composeCreate(project, home);
      expect(recreated.code, recreated.stderr).toBe(0);
      const after = await runtime.containers();
      expect(after.map((c) => c.id)).not.toContain(before[0]?.id);
      expect(after.map((c) => c.id)).not.toContain(before[1]?.id);
      // And with the containers current again, nothing changes but the start.
      expect(await predict(changed)).toEqual({
        ok: true,
        changes: [
          { service: 'a', action: 'start' },
          { service: 'b', action: 'start' },
        ],
      });
    } finally {
      down = await composeDown(project);
    }
    expect(down.code, down.stderr).toBe(0);
  });

  it('reports a compose.override.yaml that Compose rejects', async () => {
    const home = await makeHome();
    await writeFile(
      join(home, 'compose.override.yaml'),
      'services:\n  sonarr:\n    ports: 5\n',
    );
    const result = await planFor(home);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('compose.invalid');
  });

  it('notices a port something else on the host is using', async () => {
    const server = createServer();
    await new Promise<void>((done) => server.listen(8989, '127.0.0.1', done));
    try {
      const result = await planFor(await makeHome());
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'preflight.port-in-use',
          path: 'apps.sonarr.port',
        }),
      );
    } finally {
      await new Promise<void>((done) =>
        server.close(() => {
          done();
        }),
      );
    }
  });
});
