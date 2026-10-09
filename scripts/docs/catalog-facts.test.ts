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

  it('shows what an app turns on with its default settings', () => {
    expect(renderFacts(app('prowlarr'))).toContain('`byparr`');
    expect(renderFacts(app('qbittorrent'))).toContain('`gluetun`');
  });

  it('describes images with their own health check, or none', () => {
    expect(renderFacts(app('gluetun'))).toContain("- **Health check:** the image's own");
    expect(renderFacts(app('flaresolverr'))).toContain('- **Health check:** none: ');
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
});
