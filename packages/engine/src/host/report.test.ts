import { describe, expect, it } from 'vitest';
import type { HostProbe } from '../preflight/probe';
import { fakeProbe } from '../testing/fakes';
import { FIXTURE_HOST } from '../testing/fixtures';
import {
  collectHostReport,
  HelperError,
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
    };
    const report = await collectHostReport(REQUEST, probe, () => FIXTURE_HOST);
    expect(seen).toEqual(['/mediaplane-host/0', '/mediaplane-host/0/media']);
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

describe('parseHostRequest', () => {
  it('reads back what the engine sends', () => {
    expect(parseHostRequest(JSON.stringify(REQUEST))).toEqual(REQUEST);
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

  it('refuses a report from another version, or none at all', () => {
    const other = JSON.stringify({ schema: 'mediaplane.host-report/v9' });
    expect(() => parseHostReport(other)).toThrow(HelperError);
    expect(() => parseHostReport('')).toThrow(
      'the host helper printed a report Mediaplane cannot read',
    );
  });
});
