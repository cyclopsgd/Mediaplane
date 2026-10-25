import type { ActionResult, ChangeRecord, PlanResult } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import {
  driftLine,
  printApply,
  printHistory,
  printPlan,
  printRecord,
  printStep,
} from './output';
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
  drift: [],
  checks: [],
  bootstrap: [],
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

describe('printPlan: drift', () => {
  const DRIFTED: PlanResult = {
    ...PLAN,
    files: [],
    wiring: [
      { resource: 'sonarr.download_client', action: 'update', changes: ['category'] },
    ],
    drift: [
      {
        resource: 'sonarr.download_client',
        kind: 'field',
        field: 'category',
        expected: 'tv',
        actual: 'television',
      },
      {
        resource: 'sonarr.download_client',
        kind: 'field',
        field: 'enable',
        expected: true,
        actual: null,
        unreadable: 'text, not a boolean',
      },
      { resource: 'qbittorrent.category_movies', kind: 'missing' },
      { resource: 'radarr.download_client', kind: 'secret', secret: 'apiKey' },
      {
        resource: 'qbittorrent.admin',
        kind: 'secret',
        secret: 'password',
        since: '2026-10-20T08:00:00.000Z',
      },
    ],
    checks: [
      { resource: 'radarr.download_client', secret: 'apiKey', verdict: 'refused' },
    ],
  };

  it('says what apply sets, and what was applied, when stack.yaml and the app both changed', () => {
    expect(
      driftLine({
        resource: 'qbittorrent.preferences',
        kind: 'field',
        field: 'savePath',
        expected: '/data/torrents',
        applied: '/data/old',
        actual: '/data/other',
      }),
    ).toBe(
      '  ~ qbittorrent.preferences.savePath: expected "/data/torrents", actual "/data/other" (Mediaplane applied "/data/old"; stack.yaml has changed it since)',
    );
  });

  it('says what changed outside Mediaplane: what was applied, and what the app holds', () => {
    const term = capture();
    printPlan(DRIFTED, { json: false }, term.io);
    expect(term.stdout()).toBe(
      [
        'Drift, changed outside Mediaplane since it was applied:',
        '  ~ sonarr.download_client.category: expected "tv", actual "television"',
        "  ~ sonarr.download_client.enable: expected true, actual one Mediaplane can't read (text, not a boolean)",
        '  - qbittorrent.category_movies: deleted outside Mediaplane',
        "  ! radarr.download_client.apiKey: refused by the app's own check",
        "  ! qbittorrent.admin.password: refused by the app's own check (found by drift at 2026-10-20T08:00:00.000Z; not checked again until apply sets it)",
        '  apply puts each back.',
        'Wiring:',
        '  ~ update      sonarr.download_client (category)',
        'Plan: 1 resource to wire.',
        '',
      ].join('\n'),
    );
  });

  it('gives the drift and the checks in JSON', () => {
    const term = capture();
    printPlan(DRIFTED, { json: true }, term.io);
    const shown = JSON.parse(term.stdout()) as PlanResult;
    expect([shown.drift, shown.checks]).toEqual([DRIFTED.drift, DRIFTED.checks]);
  });
});

describe('printPlan', () => {
  it('shows a guest apply restarts, with the hosts it starts', () => {
    const term = capture();
    const containers: PlanResult['containers'] = [
      { service: 'gluetun', action: 'start' },
      { service: 'qbittorrent', action: 'restart' },
    ];
    printPlan({ ...PLAN, files: [], containers }, { json: false }, term.io);
    expect(term.stdout()).toBe(
      'Containers:\n  > start     gluetun\n  > restart   qbittorrent\nPlan: 2 containers to change.\n',
    );
  });

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

describe('printPlan: first-run setup', () => {
  it('lists each app to set up, and how, and counts them', () => {
    const term = capture();
    printPlan(
      {
        ...PLAN,
        files: [],
        bootstrap: [
          { app: 'jellyfin', unpublished: true },
          { app: 'other', unpublished: false },
        ],
      },
      { json: false },
      term.io,
    );
    expect(term.stdout()).toBe(
      'First-run setup:\n  + jellyfin (with no port published until it is done)\n  + other (signing in as the admin, to make its key)\nPlan: 2 apps to set up.\n',
    );
  });

  it('shows the step by its name as apply runs it', () => {
    const term = capture();
    printStep(
      {
        step: 'bootstrap',
        phase: 'end',
        action: { step: 'bootstrap', result: 'done', detail: 'set up jellyfin' },
      },
      term.io,
    );
    expect(term.stdout()).toBe('  done    first-run setup: set up jellyfin\n');
  });

  it("gives apply's plan of it in JSON", () => {
    const term = capture();
    const bootstrap = [{ app: 'jellyfin', unpublished: true }];
    printApply(
      {
        outcome: 'success',
        plan: { ...PLAN, bootstrap },
        actions: [],
        recordId: 'fake-record',
        diagnostics: [],
      },
      { json: true },
      term.io,
    );
    expect(JSON.parse(term.stdout())).toMatchObject({ plan: { bootstrap } });
  });
});

describe('the wire step, as apply shows it', () => {
  const ACTIONS: ActionResult[] = [
    { step: 'start', result: 'done', detail: 'every app is running and healthy' },
    { step: 'wire', resource: 'sonarr.admin', result: 'done', detail: 'created' },
    {
      step: 'wire',
      resource: 'radarr.admin',
      result: 'failed',
      error: 'Radarr at … refused',
    },
    { step: 'wire', result: 'failed', error: 'the wiring failed for radarr.admin' },
    { step: 'verify', result: 'skipped' },
  ];

  it("shows each resource as it is wired, and the step's failure only once, at the end", () => {
    const term = capture();
    printStep({ step: 'wire', phase: 'start' }, term.io);
    for (const action of ACTIONS.slice(1, 4)) {
      printStep({ step: 'wire', phase: 'end', action }, term.io);
    }
    expect(term.stdout()).toBe(
      'Wiring the apps…\n  done    wiring sonarr.admin: created\n  failed  wiring radarr.admin: Radarr at … refused\n  failed  wiring\n',
    );
  });

  /** What printApply says when apply failed with `actions`. */
  function failedWith(actions: ActionResult[]): string {
    const out: string[] = [];
    const io: Io = {
      stdout: () => undefined,
      stderr: (text) => {
        out.push(text);
      },
      env: {},
    };
    printApply(
      {
        outcome: 'failed',
        plan: { ...PLAN, files: [] },
        actions,
        recordId: 'fake-record',
        diagnostics: [],
      },
      { json: false },
      io,
    );
    return out.join('');
  }

  it('counts the step when it failed where none of its resources did', () => {
    // Say resources.json couldn't be written after the last resource was made.
    expect(
      failedWith([
        { step: 'start', result: 'done', detail: 'every app is running and healthy' },
        { step: 'wire', resource: 'sonarr.admin', result: 'done', detail: 'created' },
        { step: 'wire', result: 'failed', error: 'cannot write state/resources.json' },
        { step: 'verify', result: 'skipped' },
      ]),
    ).toContain('Apply failed: 2 done, 1 failed, 1 skipped. Run apply again to retry.');
  });

  it("doesn't count a resource left unchanged as a change in JSON", () => {
    const changed = (actions: ActionResult[]) => {
      const term = capture();
      printApply(
        {
          outcome: 'success',
          plan: { ...PLAN, files: [] },
          actions,
          recordId: 'fake-record',
          diagnostics: [],
        },
        { json: true },
        term.io,
      );
      return (JSON.parse(term.stdout()) as { changed: boolean }).changed;
    };
    const step: ActionResult = { step: 'wire', result: 'done', detail: 'none needed' };
    const verify: ActionResult = {
      step: 'verify',
      result: 'done',
      detail: 'no changes remain',
    };
    const resource = (detail: string): ActionResult => ({
      step: 'wire',
      resource: 'sonarr.admin',
      result: 'done',
      detail,
    });
    expect(changed([resource('unchanged'), step, verify])).toBe(false);
    expect(changed([resource('created'), step, verify])).toBe(true);
  });

  it('counts a failed resource once, not again for its step', () => {
    expect(failedWith(ACTIONS)).toContain(
      'Apply failed: 2 done, 1 failed, 1 skipped. Run apply again to retry.',
    );
  });

  it("shows a record's wiring and its resources' results", () => {
    const term = capture();
    const record: ChangeRecord = {
      schema: 'mediaplane.change/v1',
      id: '20261010T120000Z-0a1b2c3d',
      trigger: 'cli',
      startedAt: '2026-10-10T12:00:00.000Z',
      finishedAt: '2026-10-10T12:01:00.000Z',
      durationMs: 60_000,
      outcome: 'failed',
      stackSha256: '0'.repeat(64),
      plan: {
        files: [],
        containers: [],
        secrets: { generate: [] },
        wiring: [
          { resource: 'sonarr.admin', action: 'after-start' },
          { resource: 'radarr.admin', action: 'unchanged' },
        ],
      },
      actions: ACTIONS,
    };
    printRecord(record, { json: false }, term.io);
    // The same line as plan's.
    expect(term.stdout()).toContain('  > after start sonarr.admin\nSteps:\n');
    expect(term.stdout()).toContain('  done    wiring sonarr.admin: created\n');
    expect(term.stdout()).not.toContain('radarr.admin\nSteps');
    printHistory({ records: [record], unreadable: [] }, { json: false }, term.io);
    expect(term.stdout()).toContain(
      '20261010T120000Z-0a1b2c3d  failed   1 resource wired\n',
    );
  });
});
