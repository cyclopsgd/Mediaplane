import type { ActionResult, ChangeRecord, PlanResult } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { printApply, printHistory, printPlan, printRecord, printStep } from './output';
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
