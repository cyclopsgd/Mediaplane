import { describe, expect, it } from 'vitest';
import type { HostProbe } from '../preflight/probe';
import { HelperError } from '../runtime/types';
import { fakeProbe } from '../testing/fakes';
import { FIXTURE_HOST } from '../testing/fixtures';
import {
  collectHostReport,
  HOST_REPORT_SCHEMA,
  parseHostReport,
  parseHostRequest,
  type HostRequest,
} from './report';

const REQUEST: HostRequest = {
  facts: false,
  stat: [
    { key: '/srv/data', at: '/mediaplane-host/0' },
    { key: '/srv/data/media', at: '/mediaplane-host/0/media' },
  ],
  free: [{ key: '/srv/data', at: '/mediaplane-host/0' }],
  ports: [{ address: '127.0.0.1', port: 8989, protocol: 'tcp' }],
};

describe('collectHostReport', () => {
  it('looks at each path where the helper sees it, and reports it by its host path', async () => {
    const seen: string[] = [];
    const measured: string[] = [];
    const base = fakeProbe({
      stats: { '/mediaplane-host/0/media': undefined },
      busyPorts: ['tcp/127.0.0.1:8989'],
    });
    const probe: HostProbe = {
      ...base,
      stat: (path) => {
        seen.push(path);
        return base.stat(path);
      },
      freeBytes: (path) => {
        measured.push(path);
        return base.freeBytes(path);
      },
    };
    const report = await collectHostReport(REQUEST, probe, () => FIXTURE_HOST);
    expect(seen).toEqual(['/mediaplane-host/0', '/mediaplane-host/0/media']);
    expect(measured).toEqual(['/mediaplane-host/0']);
    expect(report).toEqual({
      schema: HOST_REPORT_SCHEMA,
      stat: {
        '/srv/data': expect.objectContaining({ isDirectory: true, ino: 1 }) as unknown,
        '/srv/data/media': null,
      },
      free: { '/srv/data': 100 * 1024 ** 3 },
      ports: { 'tcp/127.0.0.1:8989': false },
    });
  });

  it("reports the host's facts only when asked", async () => {
    const report = await collectHostReport(
      { facts: true, stat: [], free: [], ports: [] },
      fakeProbe(),
      () => FIXTURE_HOST,
    );
    expect(report.facts).toEqual(FIXTURE_HOST);
  });

  it("says when it can't tell", async () => {
    const probe: HostProbe = {
      ...fakeProbe(),
      freeBytes: () => Promise.resolve(undefined),
      portFree: () => Promise.resolve(undefined),
    };
    const report = await collectHostReport(REQUEST, probe, () => FIXTURE_HOST);
    expect(report.free).toEqual({ '/srv/data': null });
    expect(report.ports).toEqual({ 'tcp/127.0.0.1:8989': null });
  });
});

describe('collectHostReport, asked for the egress address', () => {
  it('asks the IP-echo service only when the request names one', async () => {
    const asked: string[] = [];
    const egress = (url: string) => {
      asked.push(url);
      return Promise.resolve({ ok: true as const, address: '198.51.100.2' });
    };
    const none = { facts: false, stat: [], free: [], ports: [] };
    const url = 'https://1.1.1.1/cdn-cgi/trace';
    const report = await collectHostReport(
      { ...none, egress: url },
      fakeProbe(),
      () => FIXTURE_HOST,
      egress,
    );
    expect(report.egress).toEqual({ ok: true, address: '198.51.100.2' });
    const without = await collectHostReport(
      none,
      fakeProbe(),
      () => FIXTURE_HOST,
      egress,
    );
    expect(without).not.toHaveProperty('egress');
    expect(asked).toEqual([url]);
  });
});

describe('parseHostRequest', () => {
  it('reads back what the engine sends', () => {
    expect(parseHostRequest(JSON.stringify(REQUEST))).toEqual(REQUEST);
  });

  it('reads back an egress URL, and refuses one that is not http or https', () => {
    const asking = { ...REQUEST, egress: 'https://1.1.1.1/cdn-cgi/trace' };
    expect(parseHostRequest(JSON.stringify(asking))).toEqual(asking);
    expect(() =>
      parseHostRequest(JSON.stringify({ ...REQUEST, egress: 'file:///etc/shadow' })),
    ).toThrow('egress: must be an http or https URL');
  });

  it('refuses anything else', () => {
    expect(() => parseHostRequest('{"facts":true}')).toThrow(
      'the host helper was given a request it cannot read',
    );
    expect(() => parseHostRequest('not json')).toThrow(
      'the host helper was given a request it cannot read',
    );
  });
});

describe('parseHostReport', () => {
  it('reads the last line the helper printed', async () => {
    const report = await collectHostReport(REQUEST, fakeProbe(), () => FIXTURE_HOST);
    expect(parseHostReport(`some warning\n${JSON.stringify(report)}\n`)).toEqual(report);
  });

  it('reads the egress answer', () => {
    const report = {
      schema: HOST_REPORT_SCHEMA,
      stat: {},
      free: {},
      ports: {},
      egress: { ok: false, error: 'no answer from https://1.1.1.1/cdn-cgi/trace' },
    };
    expect(parseHostReport(JSON.stringify(report))).toEqual(report);
  });

  it('refuses an egress address that is not an address', () => {
    const report = {
      schema: HOST_REPORT_SCHEMA,
      stat: {},
      free: {},
      ports: {},
      egress: { ok: true, address: '<html>blocked</html>' },
    };
    expect(() => parseHostReport(JSON.stringify(report))).toThrow(HelperError);
    expect(() => parseHostReport(JSON.stringify(report))).toThrow(
      'the host helper printed a report Mediaplane cannot read',
    );
    const good = { ...report, egress: { ok: true, address: '2001:db8::7' } };
    expect(parseHostReport(JSON.stringify(good))).toEqual(good);
  });

  it('refuses a report from another version, or none at all', () => {
    const other = JSON.stringify({ schema: 'mediaplane.host-report/v9' });
    expect(() => parseHostReport(other)).toThrow(HelperError);
    expect(() => parseHostReport('')).toThrow(
      'the host helper printed a report Mediaplane cannot read',
    );
  });
});
