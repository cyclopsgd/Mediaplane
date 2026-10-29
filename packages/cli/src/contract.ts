import { z } from 'zod';

/**
 * The `--json` contract (spec §5.2, §9): each document the CLI prints, as a Zod schema.
 * The JSON Schemas in docs/reference/json/ and docs/reference/json.md are generated from
 * these (`pnpm docs:generate`), and contract.test.ts checks that each printer prints
 * exactly this, field for field. Within v1 a document only gains fields and values; a
 * field that changed meaning would be a v2.
 */

const text = (description: string) => z.string().describe(description);
const list = (description: string) => z.array(z.string()).describe(description);
const flag = (description: string) => z.boolean().describe(description);

/** A value of a managed field, as `stack.yaml`'s overrides hold it. */
const scalar = z.union([z.string(), z.number(), z.boolean()]);

export const diagnosticJson = z
  .strictObject({
    severity: z
      .enum(['error', 'warning'])
      .describe('an error stopped the command; a warning did not'),
    code: text(
      'what it is, such as `config.unknown-key`: stable, for scripts to act on; the message is for people and may change',
    ),
    message: text('what is wrong, for people'),
    path: text('where in `stack.yaml`, such as `apps.qbittorrent.vpn`').optional(),
    hint: text('what to do about it').optional(),
  })
  .describe('a problem found');

const diagnostics = z
  .array(diagnosticJson)
  .describe('every error and warning, in the order found');

const fileJson = z.strictObject({
  path: text('relative to the Mediaplane home, such as `generated/compose.yaml`'),
  status: z.enum(['create', 'update', 'unchanged']),
  diff: text(
    'a unified diff from the file on disk; empty when the file is unchanged, or holds secrets',
  ),
  sensitive: flag(
    'it holds secrets: compared with the file on disk, never shown',
  ).optional(),
  prestart: flag(
    "written once, before the app's first start, and never updated",
  ).optional(),
});

const containerJson = z.strictObject({
  service: text('the Compose service, such as sonarr'),
  action: z.enum(['create', 'recreate', 'start', 'restart', 'remove', 'unchanged']),
});

const secretsJson = z
  .strictObject({
    generate: list('the secrets apply generates, by name, such as `sonarr.apiKey`'),
    recover: list(
      "the keys apply recovers from the apps' appdata, which `state/secrets.json` lacks",
    ),
    restore: list(
      "the keys apply puts back in their apps' own files, stopping each app first",
    ),
  })
  .describe('names only, never values');

const wiringJson = z.strictObject({
  resource: text(
    '`<app>.<resource>`, or `<app>` alone for an app Mediaplane only checks',
  ),
  action: z
    .enum(['create', 'update', 'adopt', 'unchanged', 'after-start', 'unknown', 'remove'])
    .describe(
      'adopt: the app holds it as wanted, and Mediaplane records it; after-start: checked once its app runs; unknown: Mediaplane could not ask the app (`reason` says why); remove: Mediaplane made it, and the stack no longer wants it',
    ),
  changes: list('the managed fields and secrets that differ, by name').optional(),
  reason: text('why it could not be checked').optional(),
});

const driftJson = z.strictObject({
  resource: text('`<app>.<resource>`, or `<app>` for an app that refuses its key'),
  kind: z
    .enum(['field', 'missing', 'secret', 'key', 'left'])
    .describe(
      "field: a managed field holds another value; missing: deleted in the app; secret: the app's own check refuses one of its secrets; key: an app refuses its own key, or a resource holds that key (`source`); left: Mediaplane made it, the stack no longer wants it, and the app still holds it",
    ),
  field: text('the managed field, for `field`').optional(),
  expected: scalar.describe('the value apply sets').optional(),
  applied: scalar
    .describe('the value Mediaplane applied, when `stack.yaml` has changed it since')
    .optional(),
  actual: scalar
    .nullable()
    .describe("what the app holds; null when Mediaplane can't read it (`unreadable`)")
    .optional(),
  unreadable: text("the shape Mediaplane can't read the value in").optional(),
  redacted: flag('`actual` or `unreadable` held a secret, shown as `***`').optional(),
  secret: text('the secret, or key, by name: never its value').optional(),
  since: text(
    'when drift found it, for a secret or key not checked again until apply sets it',
  ).optional(),
  source: text(
    'key: the app whose key the resource holds, which that app refuses',
  ).optional(),
  stays: text(
    'left: why apply leaves it in the app; without it, apply removes it',
  ).optional(),
});

const checkJson = z.strictObject({
  resource: text('`<app>.<resource>`'),
  secret: text('the secret, by name'),
  verdict: z.enum(['passed', 'refused', 'unchecked']),
  reason: text('why it was not checked').optional(),
  at: text(
    'when drift last checked it, for a verdict taken from then rather than checked again',
  ).optional(),
});

const bootstrapJson = z.strictObject({
  app: text('the app whose first-run setup apply finishes, such as jellyfin'),
  unpublished: flag('it starts with no published port until its setup is done'),
  again: flag(
    'present, and true, only when the setup signs in again with what you rotated (`--rotate plex.token`), published or not',
  ).optional(),
});

/** The plan, as `plan --json` prints it and apply's plan holds it. */
const planShape = {
  files: z.array(fileJson).describe('the files apply writes'),
  containers: z.array(containerJson).describe('what Compose does to each service'),
  secrets: secretsJson,
  unhealthy: list(
    'running apps whose health check has not passed yet, such as `sonarr (unhealthy)`: apply waits for them',
  ),
  wiring: z.array(wiringJson).describe('what apply does to each managed resource'),
  bootstrap: z.array(bootstrapJson).describe('the first-run setups apply finishes'),
};

export const planDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.plan/v1'),
    ok: flag('false when a diagnostic is an error: then nothing else is planned'),
    changed: flag('apply would change something; plan exits 2 then, and 0 when not'),
    ...planShape,
    drift: z
      .array(driftJson)
      .describe('what changed in the apps outside Mediaplane since it applied them'),
    checks: z
      .array(checkJson)
      .describe('how each secret of each resource was checked: names only'),
    diagnostics,
  })
  .describe('what apply would change: `mediaplane plan --json`');

const actionJson = z.strictObject({
  step: z.enum([
    'keys',
    'files',
    'pull',
    'ownership',
    'start',
    'bootstrap',
    'wire',
    'verify',
  ]),
  resource: text('the wire step names the resource, such as `sonarr.admin`').optional(),
  result: z.enum(['done', 'failed', 'skipped']),
  detail: text(
    "what it did. A `wire` action that names a `resource` and is `done` says exactly one of these, stable within v1: `created`, `adopted`, `unchanged`, `removed`, or `updated` and then the names of what changed, comma-separated, as the plan's `changes` names them (`updated user, password`). Otherwise it is for people: a skipped wire action says why, such as why a planned removal stays; the wire step's action with no `resource` sums up the others; the first-run setup step says what it set up and published, and `signed in again to <app>`",
  ).optional(),
  error: text('why it failed').optional(),
});

export const applyDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.apply/v1'),
    ok: flag('the apply succeeded, or there was nothing to change; apply exits 0 then'),
    changed: flag('apply changed something on the host or in the apps'),
    outcome: z
      .enum(['success', 'failed', 'no-changes', 'cancelled', 'invalid'])
      .describe(
        'invalid: the plan failed, and nothing was changed; cancelled: nothing was changed',
      ),
    plan: z.strictObject(planShape).describe('the plan apply followed'),
    actions: z.array(actionJson).describe("each step's actions, in order"),
    recordId: z
      .string()
      .nullable()
      .describe('the change record written (`mediaplane history <id>`), or null'),
    diagnostics,
  })
  .describe('what apply did: `mediaplane apply --yes --json`');

export const driftDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.drift/v1'),
    ok: flag("false when drift couldn't look: an error diagnostic says why"),
    clear: flag(
      'nothing drifted, and every resource and secret was checked: drift exits 0 then, and 2 when not',
    ),
    drift: z.array(driftJson).describe('what changed in the apps outside Mediaplane'),
    checks: z.array(checkJson).describe('how each secret was checked: names only'),
    unchecked: z
      .array(
        z.strictObject({ resource: text('`<app>.<resource>`'), reason: text('why') }),
      )
      .describe("the resources drift couldn't look at"),
    diagnostics,
  })
  .describe('what changed in the apps outside Mediaplane: `mediaplane drift --json`');

export const keepDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.keep/v1'),
    ok: flag('something was kept; keep exits 0 then'),
    key: text('the override key, or the app key (`<app>.<key>`), as asked'),
    value: scalar
      .nullable()
      .describe(
        "the value kept, or `unmanaged` for a resource; null for an app's own key, which `state/secrets.json` keeps",
      ),
    holders: list(
      "an app's own key: the resources that hold the old one, which the next apply gives the kept one",
    ).optional(),
    line: text(
      'the line under `overrides:` that keeps it, as written, or for you to add: present once keep got as far as the line',
    ).optional(),
    written: flag(
      'keep wrote `line` into `stack.yaml`; false with `managed_by: external` (a `keep.external` warning), or when it could not',
    ).optional(),
    diagnostics,
  })
  .describe('what Keep mine kept: `mediaplane keep <path> --json`');

export const migrateDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.migrate/v1'),
    ok: flag('`stack.yaml` is now, or already was, the version this Mediaplane writes'),
    from: z
      .number()
      .describe('the version `stack.yaml` was, when it could be read')
      .optional(),
    to: z.number().describe('the version this Mediaplane writes'),
    changed: flag('`stack.yaml` was rewritten'),
    applied: list('what each migration step changed, in order'),
    text: text(
      'the file as it should be, when Mediaplane may not write it (`managed_by: external`)',
    ).optional(),
    diagnostics,
  })
  .describe('what migrate did: `mediaplane migrate --json`');

const summaryJson = z
  .strictObject({
    id: text('the change record, as `mediaplane history <id>` takes it'),
    startedAt: text('when the apply started, in ISO 8601'),
    durationMs: z.number().describe('how long it took'),
    outcome: z.enum(['success', 'failed']),
    changes: z
      .strictObject({
        files: z.number().describe('files written'),
        containers: z.number().describe('containers changed'),
        secrets: z.number().describe('secrets generated'),
        wiring: z.number().describe('resources the wire step changed in the apps'),
      })
      .describe('how much it changed'),
  })
  .describe('one apply, in short');

export const statusDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.status/v1'),
    ok: z.literal(true).describe('true: the containers were listed'),
    healthy: flag(
      'there are containers, and every one is running and passes its health check',
    ),
    containers: z
      .array(
        z.strictObject({
          service: text('the Compose service'),
          state: text('running, exited, created, …'),
          health: text('healthy, unhealthy, starting, or empty with no health check'),
          published: z
            .array(
              z.strictObject({
                address: text('the host address'),
                port: z.number(),
                protocol: z.enum(['tcp', 'udp']),
              }),
            )
            .describe('where its ports are published on the host'),
        }),
      )
      .describe("the stack's containers, sorted by service"),
    lastApply: summaryJson.nullable().describe('the last apply, or null if none has run'),
    historyError: text(
      "why the change history couldn't be read; the containers are listed all the same",
    ).optional(),
  })
  .describe("each app's container, and the last apply: `mediaplane status [app] --json`");

export const historyDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.history/v1'),
    ok: z.literal(true).describe('true: the records were listed'),
    records: z.array(summaryJson).describe('every change record, newest first'),
    unreadable: list(
      "the files in `state/history/` this Mediaplane can't read: a later release's, or damaged",
    ),
  })
  .describe('the change records: `mediaplane history --json`');

export const changeDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.change/v1'),
    id: z
      .string()
      .regex(/^\d{8}T\d{6}Z-[0-9a-f]{8}$/)
      .describe('the record, such as `20261009T094312Z-a1b2c3d4`'),
    trigger: z.literal('cli'),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    durationMs: z.int().min(0),
    outcome: z.enum(['success', 'failed']),
    stackSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .describe('the SHA-256 of `stack.yaml` as applied'),
    plan: z
      .strictObject({
        files: z.array(
          z.strictObject({
            path: text('relative to the Mediaplane home'),
            status: z.enum(['create', 'update', 'unchanged']),
          }),
        ),
        containers: z.array(containerJson),
        secrets: z
          .strictObject({
            generate: list('the secrets generated, by name'),
            recover: list("the keys recovered from the apps' appdata").optional(),
            restore: list("the keys put back in their apps' own files").optional(),
          })
          .describe('names only, never values'),
        wiring: z.array(wiringJson).optional(),
        bootstrap: z.array(bootstrapJson).optional(),
      })
      .describe('the plan the apply followed, without its diffs'),
    actions: z.array(actionJson),
    ok: z.literal(true).describe('true: the record was read'),
  })
  .describe(
    "one change record, as this release knows it: `mediaplane history <id> --json`. A later release's record shows only these fields; the rest stay in its file",
  );

/** What every app's login says: which app, and where its web UI is. */
const loginShape = {
  app: text('the app, such as sonarr'),
  name: text('its name, such as Sonarr'),
  urls: list('where its web UI is published: one URL per address'),
};

export const credentialsDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.credentials/v1'),
    ok: z.literal(true).describe('true: the login was found'),
    username: text('the shared admin user name'),
    password: z
      .string()
      .nullable()
      .describe('the shared admin password with `--reveal`; null without it'),
    passwordSource: z
      .enum(['generated', 'yours'])
      .describe("generated: Mediaplane's; yours: from `admin.password`"),
    apps: z
      .array(
        z.discriminatedUnion('login', [
          z.strictObject({
            ...loginShape,
            login: z.literal('shared').describe('signs in with the shared admin'),
          }),
          z.strictObject({
            ...loginShape,
            login: z.literal('own').describe('signs in with an account of its own'),
            account: text('whose account, such as Plex'),
          }),
          z.strictObject({
            ...loginShape,
            login: z.literal('not-yet').describe('its login is still to come'),
            comingIn: text('when it comes'),
          }),
        ]),
      )
      .describe('each app with a web login'),
  })
  .describe(
    "the shared admin login, and each app's web address: `mediaplane credentials [app] --json`",
  );

export const vpnCheckDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.vpn-check/v1'),
    ok: z.literal(true).describe('true: the check ran; verdict says what it found'),
    verdict: z
      .enum(['pass', 'leak', 'down'])
      .describe('pass exits 0; leak and down exit 1'),
    checks: z
      .array(
        z.strictObject({
          id: z.enum(['network', 'gluetun', 'control', 'control-key', 'route', 'egress']),
          status: z.enum(['ok', 'warning', 'down', 'leak']),
          message: text('what it found, for people'),
          hint: text('what to do about it').optional(),
        }),
      )
      .describe('each check, in order'),
    egress: z
      .strictObject({
        url: text('the IP-echo service asked'),
        vpn: z.string().nullable().describe("qBittorrent's address, or null"),
        host: z.string().nullable().describe("this host's address, or null"),
      })
      .nullable()
      .describe('the addresses compared; null with --no-egress'),
    gluetunPublicIp: z
      .string()
      .nullable()
      .describe('the address Gluetun reports for itself, or null'),
    failClosed: flag(
      "qBittorrent was shown to be in Gluetun's network, and nothing can get out around the VPN",
    ),
  })
  .describe(
    'whether qBittorrent reaches the internet only through the VPN: `mediaplane vpn-check --json`',
  );

export const plexLoginDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.plex-login/v1'),
    ok: z.literal(true).describe('true: a token that works is saved'),
    saved: text('the file the token is saved in: never the token'),
    signedIn: flag('you signed in now; false when the saved token works already'),
    replaced: flag('it replaced another token: run `apply --rotate plex.token` next'),
  })
  .describe('your Plex sign-in: `mediaplane plex-login --json`; the link goes to stderr');

export const initDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.init/v1'),
    ok: z.literal(true).describe('true: stack.yaml was written'),
    stackPath: text('the `stack.yaml` written'),
    next: list('what to do next, for people, in order'),
  })
  .describe('the starter `stack.yaml`: `mediaplane init --json`');

export const errorDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.error/v1'),
    ok: z.literal(false),
    error: z.strictObject({
      message: text('what went wrong, for people'),
      diagnostics: z
        .array(diagnosticJson)
        .describe(
          'the diagnostics found, the error that stopped the command among them, when it has them',
        )
        .optional(),
    }),
  })
  .describe(
    'a command that stopped before it could print its own document, such as for a usage error, a missing `stack.yaml` for credentials or vpn-check, or Docker out of reach',
  );

/**
 * The diagnostic codes a script is most likely to act on, as the reference lists them.
 * Each is pinned by a test of the code that gives it (contract.test.ts checks).
 */
export const CODES: readonly { code: string; meaning: string }[] = [
  { code: 'config.missing', meaning: 'the home has no `stack.yaml`' },
  {
    code: 'config.old-version',
    meaning:
      '`stack.yaml` is an older version, read in memory (a warning): `mediaplane migrate` rewrites it',
  },
  {
    code: 'apply.locked',
    meaning:
      'another Mediaplane command holds `state/lock`; `drift.locked`, `keep.locked` and `migrate.locked` say the same of theirs. Run it again once the other is done',
  },
  {
    code: 'apply.pull-failed',
    meaning:
      'an image could not be pulled, even after the retries, before anything was stopped: run apply again',
  },
  {
    code: 'secrets.admin-password-lost',
    meaning:
      'the admin password Mediaplane generated went with `state/secrets.json` (a warning): apply generates another and sets it in each app',
  },
  {
    code: 'bootstrap.needs-password',
    meaning:
      "an app's first-run setup is held, since the app has never had the admin password Mediaplane holds: the rebuilding a host runbook says what to do",
  },
  {
    code: 'bootstrap.open-published',
    meaning:
      "an app runs published though its first-run setup isn't shown to be done (a warning): apply starts it again without its ports first",
  },
  {
    code: 'rotate.no-plex',
    meaning: '`--rotate plex.token` on a stack without Plex',
  },
  {
    code: 'keep.external',
    meaning:
      'with `managed_by: external`, keep wrote nothing in `stack.yaml` (a warning): add its `line` there',
  },
  {
    code: 'keep.record',
    meaning:
      "keep couldn't forget the record of a resource it keeps as unmanaged: run keep again before the next apply",
  },
  {
    code: 'credentials.not-yet',
    meaning: 'there is no admin password yet: run apply first',
  },
  {
    code: 'vpn-check.not-applied',
    meaning: "the stack hasn't been applied, so there is nothing to check yet",
  },
];

/**
 * What the hidden commands print: the answers of Mediaplane's own helper containers to
 * Mediaplane (host-report, plex-tv), not for scripts, so not in the contract.
 */
export const INTERNAL_SCHEMAS: readonly string[] = [
  'mediaplane.host-report/v1',
  'mediaplane.plex-tv/v1',
];

/** One --json document: the schema it names, who prints it, and its shape. */
export interface JsonDocument {
  /** mediaplane.<name>/v1 */
  schema: string;
  /** Its file in docs/reference/json/. */
  file: string;
  shape: z.ZodType;
}

export const DOCUMENTS: readonly JsonDocument[] = [
  planDocumentJson,
  applyDocumentJson,
  driftDocumentJson,
  keepDocumentJson,
  migrateDocumentJson,
  statusDocumentJson,
  historyDocumentJson,
  changeDocumentJson,
  credentialsDocumentJson,
  vpnCheckDocumentJson,
  plexLoginDocumentJson,
  initDocumentJson,
  errorDocumentJson,
].map((shape) => {
  const schema = shape.shape.schema.value;
  const name = /^mediaplane\.([a-z-]+)\/v1$/.exec(schema)?.[1] ?? schema;
  return { schema, file: `${name}.schema.json`, shape };
});

/**
 * Check one printed document against the contract, by its `schema`, strictly: a field the
 * contract doesn't document fails, as one it documents of another type does. Returns its
 * schema; throws naming the paths that don't fit, never their values.
 */
export function checkDocument(document: unknown): string {
  const schema =
    typeof document === 'object' && document !== null && 'schema' in document
      ? String(document.schema)
      : '';
  const known = DOCUMENTS.find((d) => d.schema === schema);
  if (known === undefined) throw new Error(`no documented --json schema "${schema}"`);
  const checked = known.shape.safeParse(document);
  if (!checked.success) {
    const paths = checked.error.issues.map(
      (issue) =>
        `${issue.path.join('.') || '(document)'}${issue.code === 'unrecognized_keys' ? ` ${issue.keys.join(', ')}` : ''}: ${issue.code}`,
    );
    throw new Error(
      `${schema} does not match its documented schema: ${paths.join('; ')}`,
    );
  }
  return schema;
}

/** Each JSON document in what a command printed, in order: none in a human's output. */
export function documentsIn(stdout: string): unknown[] {
  if (!stdout.startsWith('{')) return [];
  return stdout
    .split(/(?<=^\}\n)/m)
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => JSON.parse(chunk) as unknown);
}
