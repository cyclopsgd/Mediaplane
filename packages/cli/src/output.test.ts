import type {
  ActionResult,
  ChangeRecord,
  DriftResult,
  MigrateResult,
  PlanResult,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import {
  driftLine,
  printApply,
  printDrift,
  printHistory,
  printKeep,
  printMigrate,
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
  secrets: { generate: [], recover: [], restore: [] },
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
        '  apply puts back each field, resource and secret changed in the apps; mediaplane keep <app>.<resource>.<field> keeps what the app holds instead, and <app>.<resource> stops Mediaplane managing one deleted.',
        'Wiring:',
        '  ~ update      sonarr.download_client (category)',
        'Plan: 1 resource to wire.',
        '',
      ].join('\n'),
    );
  });

  it('says an app refuses its own key, which those that hold it hold too, and what is left, and what puts each right', () => {
    const term = capture();
    printPlan(
      {
        ...PLAN,
        files: [],
        drift: [
          { resource: 'qbittorrent', kind: 'key', secret: 'apiKey' },
          {
            resource: 'sonarr.download_client',
            kind: 'key',
            secret: 'apiKey',
            source: 'qbittorrent',
          },
          { resource: 'prowlarr.application_radarr', kind: 'left' },
        ],
      },
      { json: false },
      term.io,
    );
    expect(term.stdout()).toBe(
      [
        'Drift, changed outside Mediaplane since it was applied:',
        '  ! qbittorrent: refuses the key Mediaplane holds for it (apiKey), as if it was changed in the app',
        "  ! sonarr.download_client.apiKey: holds qbittorrent's key, which qbittorrent refuses",
        '  ? prowlarr.application_radarr: still in the app, though the stack no longer wants it; apply leaves it',
        "  apply puts the key Mediaplane holds back where an app keeps it in a file of its own, such as qBittorrent's, and restarts the app; for any other app, put it back as https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md shows. mediaplane keep <app>.<key> keeps the app's own key instead.",
        "  apply doesn't remove what Mediaplane made that the stack no longer wants: remove it in the app if you don't want it, or keep it as yours with mediaplane keep <app>.<resource>, which stops the report.",
        'No changes.',
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

describe('printDrift', () => {
  const FOUND: DriftResult = {
    ok: true,
    clear: false,
    drift: [
      {
        resource: 'sonarr.download_client',
        kind: 'field',
        field: 'category',
        expected: 'tv',
        actual: 'television',
      },
    ],
    checks: [
      { resource: 'sonarr.admin', secret: 'password', verdict: 'passed' },
      {
        resource: 'sonarr.download_client',
        secret: 'apiKey',
        verdict: 'unchecked',
        reason: 'a managed field differs: apply sets the secrets with it',
      },
    ],
    unchecked: [{ resource: 'radarr.admin', reason: "its app isn't running" }],
    diagnostics: [],
  };

  it('says what changed, what it could not check, and how the secrets fared, by name', () => {
    const term = capture();
    printDrift(FOUND, { json: false }, term.io);
    expect(term.stdout()).toBe(
      [
        'Changed outside Mediaplane since it was applied:',
        '  ~ sonarr.download_client.category: expected "tv", actual "television"',
        'Not checked:',
        "  ? radarr.admin: its app isn't running",
        "Secrets, checked with each app's own check: 1 passed, 1 not checked.",
        '  ? sonarr.download_client.apiKey: a managed field differs: apply sets the secrets with it',
        'Drift found.',
        '  apply puts back each field, resource and secret changed in the apps; mediaplane keep <app>.<resource>.<field> keeps what the app holds instead, and <app>.<resource> stops Mediaplane managing one deleted.',
        '',
      ].join('\n'),
    );
  });

  it('says when it found none, and when it found none only where it could look', () => {
    const clear = capture();
    printDrift(
      { ...FOUND, clear: true, drift: [], unchecked: [], checks: [] },
      { json: false },
      clear.io,
    );
    expect(clear.stdout()).toBe('No drift: the apps hold what Mediaplane applied.\n');
    const partly = capture();
    printDrift({ ...FOUND, drift: [], checks: [] }, { json: false }, partly.io);
    expect(partly.stdout()).toContain(
      'No drift found where Mediaplane could look, but it could not look at everything, or check every secret: see above.\n',
    );
  });

  it('says which secrets passed when drift last checked them, and when, rather than now', () => {
    const term = capture();
    printDrift(
      {
        ...FOUND,
        clear: true,
        drift: [],
        unchecked: [],
        checks: [
          { resource: 'sonarr.admin', secret: 'password', verdict: 'passed' },
          {
            resource: 'jellyfin.admin',
            secret: 'password',
            verdict: 'passed',
            at: '2026-10-20T08:00:00.000Z',
          },
        ],
      },
      { json: false },
      term.io,
    );
    expect(term.stdout()).toBe(
      [
        "Secrets, checked with each app's own check: 2 passed (1 as last checked).",
        "  = jellyfin.admin.password: passed when drift last checked it, at 2026-10-20T08:00:00.000Z; it isn't checked again until its time is up",
        'No drift: the apps hold what Mediaplane applied.',
        '',
      ].join('\n'),
    );
  });

  it('gives all of it in JSON, versioned', () => {
    const term = capture();
    printDrift(FOUND, { json: true }, term.io);
    expect(JSON.parse(term.stdout())).toEqual({
      schema: 'mediaplane.drift/v1',
      ...FOUND,
    });
  });
});

describe('printPlan', () => {
  it("lists the keys it recovers from the apps' appdata before those it generates, and counts them", () => {
    const term = capture();
    printPlan(
      {
        ...PLAN,
        files: [],
        secrets: {
          generate: ['admin.password'],
          recover: ['qbittorrent.apiKey', 'sonarr.apiKey'],
          restore: [],
        },
      },
      { json: false },
      term.io,
    );
    expect(term.stdout()).toBe(
      [
        "Secrets to recover from the apps' appdata: qbittorrent.apiKey, sonarr.apiKey",
        'Secrets to generate: admin.password',
        'Plan: 2 secrets to recover, 1 secret to generate.',
        '',
      ].join('\n'),
    );
  });

  it("lists the keys it puts back in their apps' own files, which restart, and counts them", () => {
    const term = capture();
    printPlan(
      {
        ...PLAN,
        files: [],
        containers: [{ service: 'qbittorrent', action: 'restart' }],
        secrets: { generate: [], recover: [], restore: ['qbittorrent.apiKey'] },
      },
      { json: false },
      term.io,
    );
    expect(term.stdout()).toBe(
      [
        'Containers:',
        '  > restart   qbittorrent',
        "Keys to put back in their apps' own files, each app stopped first: qbittorrent.apiKey",
        'Plan: 1 container to change, 1 key to put back.',
        '',
      ].join('\n'),
    );
  });

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
        secrets: { generate: [], recover: ['sonarr.apiKey'] },
        wiring: [
          { resource: 'sonarr.admin', action: 'after-start' },
          { resource: 'radarr.admin', action: 'unchanged' },
        ],
      },
      actions: ACTIONS,
    };
    printRecord(record, { json: false }, term.io);
    expect(term.stdout()).toContain(
      '  secrets recovered from appdata: sonarr.apiKey\n  > after start',
    );
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

describe('printKeep', () => {
  it("says it kept an app's own key, never showing it, and what apply gives it to", () => {
    const term = capture();
    printKeep(
      {
        ok: true,
        key: 'qbittorrent.apiKey',
        value: undefined,
        holders: ['radarr.download_client', 'sonarr.download_client'],
        diagnostics: [],
      },
      { json: false },
      term.io,
    );
    expect(term.stdout()).toBe(
      "Kept qbittorrent's own key (qbittorrent.apiKey) in state/secrets.json, where Mediaplane keeps its keys; stack.yaml is as it was.\nRun apply to give it to radarr.download_client, sonarr.download_client, which hold the old one.\n",
    );
    const none = capture();
    printKeep(
      { ok: true, key: 'sonarr.apiKey', value: undefined, holders: [], diagnostics: [] },
      { json: false },
      none.io,
    );
    expect(none.stdout()).toContain('No resource of the stack holds the old one.\n');
    const json = capture();
    printKeep(
      { ok: true, key: 'sonarr.apiKey', value: undefined, holders: [], diagnostics: [] },
      { json: true },
      json.io,
    );
    expect(JSON.parse(json.stdout())).toEqual({
      schema: 'mediaplane.keep/v1',
      ok: true,
      key: 'sonarr.apiKey',
      value: null,
      holders: [],
      diagnostics: [],
    });
  });
});

describe('printMigrate', () => {
  function both() {
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = {
      stdout: (text) => {
        out.push(text);
      },
      stderr: (text) => {
        err.push(text);
      },
      env: {},
    };
    return { io, stdout: () => out.join(''), stderr: () => err.join('') };
  }
  const CHANGED: MigrateResult = {
    ok: true,
    from: 0,
    to: 1,
    changed: true,
    applied: ['media is now media_server'],
    diagnostics: [],
  };

  it('says what it rewrote, step by step', () => {
    const term = both();
    printMigrate(CHANGED, { json: false }, term.io);
    expect(term.stdout()).toBe(
      'Rewrote stack.yaml from version 0 to version 1, keeping its comments:\n  - media is now media_server\n',
    );
  });

  it('says when there was nothing to do', () => {
    const term = both();
    printMigrate(
      { ok: true, from: 1, to: 1, changed: false, applied: [], diagnostics: [] },
      { json: false },
      term.io,
    );
    expect(term.stdout()).toBe(
      'stack.yaml is version 1, the version this Mediaplane writes: nothing to migrate.\n',
    );
  });

  it('gives the file as it should be when it may not write it, on stdout alone', () => {
    const term = both();
    printMigrate(
      {
        ...CHANGED,
        ok: false,
        changed: false,
        text: 'version: 1\n',
        diagnostics: [
          {
            severity: 'error',
            code: 'migrate.external',
            message: 'stack.yaml is managed outside Mediaplane',
          },
        ],
      },
      { json: false },
      term.io,
    );
    expect(term.stdout()).toBe('version: 1\n');
    expect(term.stderr()).toContain('error: stack.yaml is managed outside Mediaplane');
    expect(term.stderr()).toContain(
      'stack.yaml is as it was. As version 1, it reads as above, on standard output.\n',
    );
  });

  it('prints mediaplane.migrate/v1 with --json', () => {
    const term = both();
    printMigrate(CHANGED, { json: true }, term.io);
    expect(JSON.parse(term.stdout())).toEqual({
      schema: 'mediaplane.migrate/v1',
      ...CHANGED,
    });
  });
});
