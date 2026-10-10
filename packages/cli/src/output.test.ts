import type { PlanResult } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { printPlan } from './output';
import type { Io } from './run';

function capture() {
  const out: string[] = [];
  const io: Io = {
    stdout: (text) => {
      out.push(text);
    },
    stderr: () => undefined,
    env: {},
  };
  return { io, stdout: () => out.join('') };
}

const PLAN: PlanResult = {
  ok: true,
  changed: true,
  files: [
    {
      path: 'appdata/sonarr/config.xml',
      status: 'create',
      diff: '',
      content: '',
      sensitive: true,
      prestart: true,
    },
  ],
  containers: [],
  secrets: { generate: [] },
  unhealthy: [],
  wiring: [],
  diagnostics: [],
};

describe('printPlan: the wiring', () => {
  const WIRED: PlanResult = {
    ...PLAN,
    files: [],
    wiring: [
      { resource: 'sonarr.admin', action: 'create' },
      { resource: 'radarr.admin', action: 'update', changes: ['username', 'password'] },
      { resource: 'prowlarr.admin', action: 'adopt' },
      { resource: 'qbittorrent', action: 'unchanged' },
      { resource: 'seerr.admin', action: 'after-start' },
      { resource: 'jellyfin.admin', action: 'unknown', reason: 'Jellyfin at … refused' },
    ],
  };

  it('lists what it would wire, with the names of what differs, and counts it', () => {
    const term = capture();
    printPlan(WIRED, { json: false }, term.io);
    expect(term.stdout()).toBe(
      [
        'Wiring:',
        '  + create      sonarr.admin',
        '  ~ update      radarr.admin (username, password)',
        '  = adopt       prowlarr.admin',
        '  > after start seerr.admin',
        '  ? unknown     jellyfin.admin',
        'Plan: 3 resources to wire, 1 wiring check after the start, 1 wiring check that could not be made.',
        '',
      ].join('\n'),
    );
  });

  it('gives every resource in JSON, unchanged ones too', () => {
    const term = capture();
    printPlan(WIRED, { json: true }, term.io);
    expect((JSON.parse(term.stdout()) as PlanResult).wiring).toEqual(WIRED.wiring);
  });
});

describe('printPlan', () => {
  it('shows a pre-start file as written before first start, without its content', () => {
    const term = capture();
    printPlan(PLAN, { json: false }, term.io);
    expect(term.stdout()).toBe(
      '+ appdata/sonarr/config.xml (before first start; secret values, not shown)\n\nPlan: 1 file to write.\n',
    );
  });

  it('marks it in JSON', () => {
    const term = capture();
    printPlan(PLAN, { json: true }, term.io);
    expect(JSON.parse(term.stdout())).toMatchObject({
      files: [
        {
          path: 'appdata/sonarr/config.xml',
          status: 'create',
          diff: '',
          sensitive: true,
          prestart: true,
        },
      ],
    });
  });
});
