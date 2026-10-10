import {
  composeToYaml,
  emptySecretStore,
  parseConfig,
  renderCompose,
  renderPrestartFiles,
  resolveStack,
  withGeneratedSecrets,
  type Diagnostic,
  type HostFacts,
  type PrestartFile,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { catalog } from './index';

const HOST: HostFacts = {
  arch: 'arm64',
  privateAddresses: [{ address: '192.168.1.10', cidr: '192.168.1.10/24' }],
};

/** docs/design/m1-engine-cli.md §4.2, trimmed to what Slice 1 understands. */
const SPEC_EXAMPLE = `version: 1
timezone: Europe/London
paths: { data: /srv/data }
network: { bind: lan }
media_server: jellyfin
vpn:
  provider: mullvad
  private_key: { file: secrets/wg.key }
apps:
  sonarr: {}
  radarr: { port: 7879 }
  prowlarr: {}
  qbittorrent: {}
  seerr: {}
`;

function resolve(source: string, host: HostFacts = HOST) {
  const parsed = parseConfig(source);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return resolveStack(parsed.config, catalog, host, '/opt/mediaplane');
}

function render(source: string, host: HostFacts = HOST) {
  const result = resolve(source, host);
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return { compose: renderCompose(result.stack), diagnostics: result.diagnostics };
}

const codes = (diagnostics: Diagnostic[]) => diagnostics.map((d) => d.code);

describe('the real catalog', () => {
  it.each(['amd64', 'arm64'] as const)(
    'resolves the design-spec example on %s',
    (arch) => {
      const { compose, diagnostics } = render(SPEC_EXAMPLE, { ...HOST, arch });
      expect(diagnostics).toEqual([]);
      expect(Object.keys(compose.services)).toEqual([
        'byparr',
        'gluetun',
        'jellyfin',
        'prowlarr',
        'qbittorrent',
        'radarr',
        'seerr',
        'sonarr',
      ]);
    },
  );

  it('puts qBittorrent inside Gluetun and publishes its UI on Gluetun', () => {
    const { compose } = render(SPEC_EXAMPLE);
    expect(compose.services.qbittorrent?.network_mode).toBe('service:gluetun');
    expect(compose.services.qbittorrent?.depends_on).toEqual({
      gluetun: { condition: 'service_healthy', restart: true },
    });
    expect(compose.services.qbittorrent?.ports).toBeUndefined();
    expect(compose.services.gluetun?.ports).toEqual(['192.168.1.10:8080:8080']);
    expect(compose.services.gluetun).toMatchObject({
      cap_add: ['NET_ADMIN'],
      devices: ['/dev/net/tun:/dev/net/tun'],
    });
  });

  it('publishes a port override on the host side only', () => {
    expect(render(SPEC_EXAMPLE).compose.services.radarr?.ports).toEqual([
      '192.168.1.10:7879:7878',
    ]);
  });

  it('never publishes the Cloudflare solver', () => {
    expect(render(SPEC_EXAMPLE).compose.services.byparr?.ports).toBeUndefined();
  });

  it('gives Byparr a health check that passes within a minute', () => {
    expect(render(SPEC_EXAMPLE).compose.services.byparr?.healthcheck).toEqual({
      test: ['CMD', 'curl', '-fsS', '-o', '/dev/null', 'http://127.0.0.1:8191/health'],
      interval: '30s',
      timeout: '10s',
      retries: 5,
      start_period: '60s',
    });
  });

  it('pins every image by digest', () => {
    for (const service of Object.values(render(SPEC_EXAMPLE).compose.services)) {
      expect(service.image).toMatch(/:[^@]+@sha256:[0-9a-f]{64}$/);
    }
  });

  it('keeps secrets out of compose.yaml', () => {
    const yaml = composeToYaml(render(SPEC_EXAMPLE).compose, '/opt/mediaplane');
    for (const reference of [
      '${MP_SONARR_API_KEY}',
      '${MP_RADARR_API_KEY}',
      '${MP_PROWLARR_API_KEY}',
      '${MP_SEERR_API_KEY}',
      '${MP_GLUETUN_WIREGUARD_KEY}',
    ]) {
      expect(yaml).toContain(reference);
    }
    expect(yaml).not.toContain('secrets/wg.key');
  });

  it('requires login on the LAN by default', () => {
    const env = render(SPEC_EXAMPLE).compose.services.sonarr?.environment;
    expect(env).toMatchObject({
      SONARR__AUTH__METHOD: 'Forms',
      SONARR__AUTH__REQUIRED: 'Enabled',
    });
    expect(env).not.toHaveProperty('SONARR__SERVER__TRUSTEDNETWORKS');
  });

  it('trusts only the LAN subnet when login on the LAN is turned off', () => {
    const source = SPEC_EXAMPLE.replace(
      'network: { bind: lan }',
      'network: { bind: lan }\nsecurity: { login_on_lan: false }',
    );
    expect(render(source).compose.services.radarr?.environment).toMatchObject({
      RADARR__AUTH__REQUIRED: 'DisabledForLocalAddresses',
      RADARR__SERVER__TRUSTEDNETWORKS: '192.168.1.0/24',
    });
  });

  it('names only itself and its web addresses as hosts when login on the LAN is off', () => {
    // The apps refuse to save their settings without AllowedHosts in this mode.
    const off = (bind: string) =>
      SPEC_EXAMPLE.replace(
        'network: { bind: lan }',
        `network: { bind: ${bind} }\nsecurity: { login_on_lan: false }`,
      );
    expect(render(off('lan')).compose.services.radarr?.environment).toMatchObject({
      RADARR__SERVER__ALLOWEDHOSTS: 'radarr,192.168.1.10',
    });
    // localhost and 127.0.0.1 always pass.
    expect(render(off('localhost')).compose.services.prowlarr?.environment).toMatchObject(
      { PROWLARR__SERVER__ALLOWEDHOSTS: 'prowlarr' },
    );
    expect(render(SPEC_EXAMPLE).compose.services.sonarr?.environment).not.toHaveProperty(
      'SONARR__SERVER__ALLOWEDHOSTS',
    );
  });

  it('puts the apps Mediaplane calls on the internal wiring network, Gluetun for qBittorrent', () => {
    const { compose } = render(SPEC_EXAMPLE);
    expect(compose.networks).toEqual({ wiring: { internal: true } });
    const wired = Object.entries(compose.services)
      .filter(([, service]) => service.networks !== undefined)
      .map(([id, service]) => `${id} ${String(service.networks)}`);
    expect(wired).toEqual([
      'gluetun default,wiring',
      'prowlarr default,wiring',
      'radarr default,wiring',
      'sonarr default,wiring',
    ]);
    const direct = SPEC_EXAMPLE.replace(
      '  qbittorrent: {}',
      '  qbittorrent: { vpn: false }',
    );
    expect(render(direct).compose.services.qbittorrent?.networks).toEqual([
      'default',
      'wiring',
    ]);
  });

  it("refuses a qBittorrent port that clashes with Gluetun's control server", () => {
    const source = SPEC_EXAMPLE.replace(
      '  qbittorrent: {}',
      '  qbittorrent: { port: 8000 }',
    );
    expect(codes(resolve(source).diagnostics)).toContain('port.namespace-conflict');
  });

  it('lets the LAN reach apps inside the VPN namespace', () => {
    expect(render(SPEC_EXAMPLE).compose.services.gluetun?.environment).toMatchObject({
      VPN_SERVICE_PROVIDER: 'mullvad',
      VPN_TYPE: 'wireguard',
      FIREWALL_OUTBOUND_SUBNETS: '192.168.1.0/24',
    });
  });

  it('trusts no subnet, and lets nothing in through Gluetun, with bind: localhost', () => {
    const source = SPEC_EXAMPLE.replace(
      'network: { bind: lan }',
      'network: { bind: localhost }\nsecurity: { login_on_lan: false }',
    );
    const { compose, diagnostics } = render(source);
    expect(diagnostics).toEqual([]);
    expect(compose.services.radarr?.environment).toMatchObject({
      RADARR__AUTH__REQUIRED: 'DisabledForLocalAddresses',
    });
    expect(compose.services.radarr?.environment).not.toHaveProperty(
      'RADARR__SERVER__TRUSTEDNETWORKS',
    );
    expect(compose.services.gluetun?.environment).not.toHaveProperty(
      'FIREWALL_OUTBOUND_SUBNETS',
    );
  });

  it('warns when the web UIs are on the LAN but Mediaplane knows no LAN subnet', () => {
    const source = SPEC_EXAMPLE.replace(
      'network: { bind: lan }',
      'network: { bind: all }',
    );
    const { compose, diagnostics } = render(source, { ...HOST, cloud: 'Oracle Cloud' });
    expect(codes(diagnostics)).toEqual(['network.no-lan-subnet', 'network.bind-all']);
    expect(diagnostics[0]).toEqual({
      severity: 'warning',
      code: 'network.no-lan-subnet',
      message:
        "the web UIs are published on the LAN, but Mediaplane knows no LAN subnet, so Gluetun's firewall keeps your LAN out of qBittorrent's web UI",
      path: 'network.lan_subnet',
      hint: 'set network.lan_subnet to your LAN, such as 192.168.1.0/24',
    });
    expect(compose.services.gluetun?.environment).not.toHaveProperty(
      'FIREWALL_OUTBOUND_SUBNETS',
    );
  });

  it("warns once about the missing LAN subnet behind the VPN, with Gluetun's warning", () => {
    // The LAN can't reach qBittorrent through Gluetun's firewall, so its login is moot.
    const source = SPEC_EXAMPLE.replace(
      'network: { bind: lan }',
      'network: { bind: all }\nsecurity: { login_on_lan: false }',
    );
    const { diagnostics } = render(source, { ...HOST, cloud: 'Oracle Cloud' });
    expect(codes(diagnostics)).toEqual(['network.no-lan-subnet', 'network.bind-all']);
    expect(diagnostics[0]?.message).toBe(
      "the web UIs are published on the LAN, but Mediaplane knows no LAN subnet, so Gluetun's firewall keeps your LAN out of qBittorrent's web UI",
    );
  });

  it('runs Seerr with init and its own fixed user', () => {
    const seerr = render(SPEC_EXAMPLE).compose.services.seerr;
    expect(seerr?.init).toBe(true);
    expect(seerr?.environment).not.toHaveProperty('PUID');
    expect(seerr?.user).toBeUndefined();
  });

  it('warns, and publishes qBittorrent directly, when the VPN is off', () => {
    const source = SPEC_EXAMPLE.replace(/vpn:\n(?: {2}.*\n)+/, '').replace(
      '  qbittorrent: {}',
      '  qbittorrent: { vpn: false }',
    );
    const { compose, diagnostics } = render(source);
    expect(codes(diagnostics)).toEqual(['qbittorrent.no-vpn']);
    expect(compose.services.gluetun).toBeUndefined();
    expect(compose.services.qbittorrent?.ports).toEqual(['192.168.1.10:8080:8080']);
  });

  it('fails without a vpn: block while the VPN is on', () => {
    const source = SPEC_EXAMPLE.replace(/vpn:\n(?: {2}.*\n)+/, '');
    const result = resolve(source);
    expect(codes(result.diagnostics)).toContain('vpn.missing');
    expect(result.stack).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'vpn.missing', severity: 'error' }),
    );
  });

  it('uses FlareSolverr instead of Byparr when it is listed', () => {
    const { compose } = render(`${SPEC_EXAMPLE}  flaresolverr: {}\n`);
    expect(compose.services.flaresolverr).toBeDefined();
    expect(compose.services.byparr).toBeUndefined();
  });

  it('supports Plex as the media server', () => {
    const source = SPEC_EXAMPLE.replace(
      'media_server: jellyfin',
      'media_server: plex\nplex: { token: { env: PLEX_TOKEN } }',
    );
    const { compose } = render(source);
    expect(compose.services.plex?.environment).toMatchObject({ VERSION: 'docker' });
    expect(compose.services.jellyfin).toBeUndefined();
  });
});

const zeros = (size: number) => Buffer.alloc(size, 0);

/** The pre-start files for `source`, with every generated key all zeros. */
function prestartFiles(source: string, host: HostFacts = HOST): PrestartFile[] {
  const result = resolve(source, host);
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  const { store } = withGeneratedSecrets(result.stack, emptySecretStore(), zeros);
  return renderPrestartFiles(
    result.stack,
    store,
    { username: 'admin', password: 'fake-admin-password' },
    zeros,
  );
}

const contentOf = (files: PrestartFile[], path: string) =>
  files.find((file) => file.path === path)?.content;

describe('pre-start files', () => {
  it('lists every file the stack writes before its apps first start', () => {
    expect(prestartFiles(SPEC_EXAMPLE).map((file) => file.path)).toEqual([
      'appdata/gluetun/auth/config.toml',
      'appdata/prowlarr/config.xml',
      'appdata/qbittorrent/qBittorrent/qBittorrent.conf',
      'appdata/radarr/config.xml',
      'appdata/sonarr/config.xml',
    ]);
  });

  it('gives Sonarr, Radarr and Prowlarr their key and the forms login in config.xml', () => {
    const files = prestartFiles(SPEC_EXAMPLE);
    for (const app of ['prowlarr', 'radarr', 'sonarr']) {
      expect(contentOf(files, `appdata/${app}/config.xml`)).toBe(
        [
          '<Config>',
          `  <ApiKey>${'0'.repeat(32)}</ApiKey>`,
          '  <AuthenticationMethod>Forms</AuthenticationMethod>',
          '  <AuthenticationRequired>Enabled</AuthenticationRequired>',
          '</Config>',
          '',
        ].join('\n'),
      );
    }
  });

  it('lets local addresses skip the login in config.xml when login_on_lan is false', () => {
    const source = SPEC_EXAMPLE.replace(
      'network: { bind: lan }',
      'network: { bind: lan }\nsecurity: { login_on_lan: false }',
    );
    expect(contentOf(prestartFiles(source), 'appdata/sonarr/config.xml')).toContain(
      '<AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>',
    );
  });

  it("closes Gluetun's control server to all but reading the VPN status, with a key", () => {
    expect(
      contentOf(prestartFiles(SPEC_EXAMPLE), 'appdata/gluetun/auth/config.toml'),
    ).toBe(
      [
        '[[roles]]',
        'name = "mediaplane"',
        'routes = ["GET /v1/vpn/status", "GET /v1/publicip/ip"]',
        'auth = "apikey"',
        `apikey = "${'0'.repeat(32)}"`,
        '',
      ].join('\n'),
    );
  });

  it('knows its own files, and not a config.xml Sonarr wrote without one', () => {
    const files = prestartFiles(SPEC_EXAMPLE);
    for (const file of files) expect(file.seeded.test(file.content)).toBe(true);
    const sonarr = files.find((file) => file.path === 'appdata/sonarr/config.xml');
    // What Sonarr writes itself when it starts with only the environment variable.
    const ownFile =
      '<Config>\n  <BindAddress>*</BindAddress>\n  <Port>8989</Port>\n  <UrlBase></UrlBase>\n</Config>\n';
    expect(sonarr?.seeded.test(ownFile)).toBe(false);
  });

  it('still knows a config.xml the app has rewritten around its key', () => {
    const files = prestartFiles(SPEC_EXAMPLE);
    // What Sonarr, Radarr and Prowlarr make of the file: more settings, their own layout.
    const rewritten = [
      '<Config>',
      '\t<LogLevel>info</LogLevel>',
      '\t<Port>8989</Port>',
      `\t<ApiKey>${'0'.repeat(32)}</ApiKey>`,
      '\t<AuthenticationMethod>Forms</AuthenticationMethod>',
      '\t<Branch>main</Branch>',
      '</Config>',
    ].join('\r\n');
    for (const app of ['prowlarr', 'radarr', 'sonarr']) {
      const file = files.find((f) => f.path === `appdata/${app}/config.xml`);
      expect(file?.seeded.test(rewritten)).toBe(true);
    }
  });

  it("knows Gluetun's file by Mediaplane's role, not by anyone's key", () => {
    const gluetun = prestartFiles(SPEC_EXAMPLE).find(
      (f) => f.path === 'appdata/gluetun/auth/config.toml',
    );
    // Your own roles from before Slice 3a: without a key, or with one of your own.
    const withoutKey = ['[[roles]]', 'name = "mine"', 'auth = "none"', ''].join('\n');
    const withYourKey = [
      '[[roles]]',
      'name = "mine"',
      'routes = ["GET /v1/vpn/status"]',
      'auth = "apikey"',
      `apikey = "${'1'.repeat(32)}"`,
      '',
    ].join('\n');
    expect(gluetun?.seeded.test(withoutKey)).toBe(false);
    expect(gluetun?.seeded.test(withYourKey)).toBe(false);
    // Mediaplane's role, with your own roles added below it.
    expect(gluetun?.seeded.test(`${gluetun.content}\n${withYourKey}`)).toBe(true);
  });

  it('writes no Gluetun file, and keeps no key for it, without the VPN', () => {
    const source = SPEC_EXAMPLE.replace(
      /vpn:\n {2}provider: mullvad\n {2}private_key: \{ file: secrets\/wg.key \}\n/,
      '',
    ).replace('qbittorrent: {}', 'qbittorrent: { vpn: false }');
    expect(source).not.toContain('vpn:\n');
    const result = resolve(source);
    if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
    const { store, generated } = withGeneratedSecrets(
      result.stack,
      emptySecretStore(),
      zeros,
    );
    expect(store.apps.gluetun).toBeUndefined();
    expect(generated.filter((name) => name.startsWith('gluetun.'))).toEqual([]);
    expect(prestartFiles(source).map((file) => file.path)).toEqual([
      'appdata/prowlarr/config.xml',
      'appdata/qbittorrent/qBittorrent/qBittorrent.conf',
      'appdata/radarr/config.xml',
      'appdata/sonarr/config.xml',
    ]);
  });
});
