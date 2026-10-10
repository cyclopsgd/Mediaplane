import { catalog } from '@mediaplane/catalog';
import type { AppDefinition } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { FACTS_END, FACTS_START, renderFacts, withFacts } from './catalog-facts';

function app(id: string): AppDefinition {
  const def = catalog.find((d) => d.id === id);
  if (def === undefined) throw new Error(`no app ${id}`);
  return def;
}

describe('renderFacts', () => {
  it('shows the pin, ports, volumes, user, health check and secrets', () => {
    const sonarr = app('sonarr');
    const text = renderFacts(sonarr);
    expect(text).toContain(`\`${sonarr.image.repo}:${sonarr.image.tag}\``);
    expect(text).toContain(sonarr.image.digest);
    expect(text).toContain('8989/tcp (web)');
    expect(text).toContain('`<home>/appdata/sonarr` → `/config`');
    expect(text).toContain("the stack's `user:`, through `PUID` and `PGID`");
    expect(text).toContain('`curl -fsS http://localhost:8989/ping`, every 30s');
    expect(text).toContain('`apiKey`: 32 random hex characters');
  });

  it('writes one list item per setting, not a table, so it reads on a phone', () => {
    const text = renderFacts(app('sonarr'));
    expect(text).toContain('## What Mediaplane sets');
    expect(text).toContain('- **Image:** `lscr.io/linuxserver/sonarr:');
    expect(text).toContain('- **Digest:** `sha256:');
    expect(text).toContain('- **Health check:** `curl');
    expect(text).not.toContain('| Setting |');
    expect(text).not.toContain('| --- |');
  });

  it('says when the image fixes its user, and keeps a pipe in a health check as it is', () => {
    const text = renderFacts(app('seerr'));
    expect(text).toContain('uid 1000');
    expect(text).toContain('|| exit 1');
    expect(text).not.toContain('\\|');
  });

  it('shows Compose escapes as the shell sees them', () => {
    expect(renderFacts(app('qbittorrent'))).toContain('${WEBUI_PORT}');
    expect(renderFacts(app('qbittorrent'))).not.toContain('$${WEBUI_PORT}');
  });

  it("says how Mediaplane reaches an app's API, or that it calls none", () => {
    expect(renderFacts(app('sonarr'))).toContain(
      "- **API:** on its `web` port, which Mediaplane reaches over the stack's wiring network, with `apiKey` in the `X-Api-Key` header\n",
    );
    expect(renderFacts(app('qbittorrent'))).toContain(
      'with `apiKey` as a Bearer token\n',
    );
    expect(renderFacts(app('jellyfin'))).toContain(
      '- **API:** none that Mediaplane calls\n',
    );
  });

  it('shows what an app turns on with its default settings', () => {
    expect(renderFacts(app('prowlarr'))).toContain('`byparr`');
    expect(renderFacts(app('qbittorrent'))).toContain('`gluetun`');
  });

  it('describes images with their own health check, or none', () => {
    expect(renderFacts(app('gluetun'))).toContain("- **Health check:** the image's own");
    expect(renderFacts(app('flaresolverr'))).toContain('- **Health check:** none: ');
  });

  it('shows a longer start period when the app sets one', () => {
    expect(renderFacts(app('jellyfin'))).toContain(
      '(timeout 10s, 5 retries, 120s to start)',
    );
    expect(renderFacts(app('sonarr'))).toContain(
      '(timeout 10s, 5 retries, 60s to start)',
    );
  });

  describe('ports', () => {
    it('says a port that is never published is inside the stack only', () => {
      expect(renderFacts(app('byparr'))).toContain(
        '- **Ports:** 8191/tcp (api), inside the stack only',
      );
    });

    it('says what apps.<id>.port moves, for a published port', () => {
      expect(renderFacts(app('sonarr'))).toContain(
        '`apps.sonarr.port` moves the host port\n',
      );
    });

    it('says when the host and container port move together, and by which variable', () => {
      expect(renderFacts(app('qbittorrent'))).toContain(
        '`apps.qbittorrent.port` moves the host and container port together (`WEBUI_PORT`)',
      );
    });
  });

  describe('secrets', () => {
    it('describes a generated hex key', () => {
      expect(renderFacts(app('sonarr'))).toContain(
        '`apiKey`: 32 random hex characters, generated once and kept in `state/secrets.json`',
      );
    });

    it("describes qBittorrent's generated key", () => {
      expect(renderFacts(app('qbittorrent'))).toContain(
        '`apiKey`: `qbt_` and 28 random letters and digits, generated once and kept in `state/secrets.json`',
      );
    });

    it('describes a secret the app creates itself', () => {
      expect(renderFacts(app('jellyfin'))).toContain(
        '`apiKey`: created by the app during its first-run setup',
      );
    });

    it('describes a secret the user provides, by its place in stack.yaml', () => {
      expect(renderFacts(app('plex'))).toContain(
        '`token`: yours, from `plex.token` in `stack.yaml`',
      );
      expect(renderFacts(app('gluetun'))).toContain(
        '`wireguardKey`: yours, from `vpn.private_key` in `stack.yaml`',
      );
    });

    it('says none when an app has no secrets', () => {
      expect(renderFacts(app('byparr'))).toContain('- **Secrets:** none');
    });
  });

  describe('an app no catalog entry resembles', () => {
    const bare: AppDefinition = {
      id: 'bare',
      name: 'Bare',
      category: 'download',
      image: {
        repo: 'example.invalid/bare',
        tag: '1.0.0',
        digest: `sha256:${'0'.repeat(64)}`,
      },
      arch: ['amd64'],
      ports: [],
      volumes: {},
      runAs: 'user-directive',
      provides: [],
      requires: [],
      secrets: {},
      credentials: [],
      health: { test: ['CMD', 'true'] },
      experimental: false,
    };

    it('says none or nothing where it has nothing to list', () => {
      const text = renderFacts(bare);
      expect(text).toContain('- **Ports:** none');
      expect(text).toContain('- **Volumes:** none');
      expect(text).toContain('- **Secrets:** none');
      expect(text).toContain('- **Needs:** nothing');
      expect(text).toContain('- **Provides:** nothing');
      expect(text).toContain('- **Also turns on:** nothing');
    });

    it("shows a user that Compose's user: sets", () => {
      expect(renderFacts(bare)).toContain(
        "- **Runs as:** the stack's `user:`, through Compose's `user:`",
      );
    });

    it('shows the protocol of a port that is not TCP', () => {
      const text = renderFacts({
        ...bare,
        ports: [{ name: 'discovery', container: 1900, protocol: 'udp' }],
      });
      expect(text).toContain('1900/udp (discovery)');
    });
  });
});

describe('withFacts', () => {
  const readme = `# Sonarr\n\nIntro.\n\n${FACTS_START}\nold\n${FACTS_END}\n\n## Known issues\n`;

  it('replaces only the generated block', () => {
    const out = withFacts(readme, app('sonarr'), 'catalog/sonarr/README.md');
    expect(out.startsWith('# Sonarr\n\nIntro.\n\n')).toBe(true);
    expect(out).not.toContain('\nold\n');
    expect(out.endsWith(`${FACTS_END}\n\n## Known issues\n`)).toBe(true);
  });

  it('refuses a README without the markers', () => {
    expect(() =>
      withFacts('# Sonarr\n', app('sonarr'), 'catalog/sonarr/README.md'),
    ).toThrow('catalog/sonarr/README.md needs the lines');
  });

  it('refuses a README with only one of the markers', () => {
    for (const only of [FACTS_START, FACTS_END]) {
      expect(() =>
        withFacts(`# Sonarr\n\n${only}\n`, app('sonarr'), 'catalog/sonarr/README.md'),
      ).toThrow('catalog/sonarr/README.md needs the lines');
    }
  });

  it('refuses a README whose end marker comes before its start marker', () => {
    expect(() =>
      withFacts(
        `# Sonarr\n\n${FACTS_END}\nold\n${FACTS_START}\n`,
        app('sonarr'),
        'catalog/sonarr/README.md',
      ),
    ).toThrow('catalog/sonarr/README.md needs the lines');
  });
});
