import { z } from 'zod';
import { compare } from '../util/sort';

export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** An octet 0-255 without leading zeros, which some parsers read as octal. */
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_CIDR = new RegExp(`^${OCTET}(?:\\.${OCTET}){3}\\/(?:\\d|[12]\\d|3[0-2])$`);
/** A Docker image tag: letters, digits, "_", "." and "-", not starting with "." or "-". */
const DOCKER_TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

function isIpv4Cidr(value: string): boolean {
  return IPV4_CIDR.test(value);
}
/** `<app>.<resource>` or `<app>.<resource>.<field>`; field names are camelCase. */
const OVERRIDE_KEY = /^[a-z0-9-]+(?:\.[A-Za-z0-9_]+){1,2}$/;

const OVERRIDE_KEY_MESSAGE =
  'override keys look like <app>.<resource>.<field>, e.g. sonarr.download_client.category';
const OVERRIDE_VALUE_MESSAGE = 'override values must be a string, number or boolean';
const ENV_NAME_MESSAGE =
  'environment variable names use letters, digits and _, and cannot start with a digit';

const ENV_VALUE_MESSAGE =
  'env values are strings, or { file: … } / { env: … } references for secrets';

const INLINE_SECRET =
  'inline secrets are not allowed in stack.yaml; use { file: secrets/<name> } or { env: VAR_NAME }';

/** A pointer to a secret, never the secret itself (ADR 0009). */
export const secretRefSchema = z
  .union(
    [
      z.strictObject({
        file: z
          .string()
          .min(1)
          .describe(
            'A file that holds the secret, relative to the Mediaplane home, such as secrets/wg.key.',
          ),
      }),
      z.strictObject({
        env: z
          .string()
          .regex(ENV_NAME)
          .describe('An environment variable that holds the secret.'),
      }),
    ],
    {
      error: (issue) =>
        typeof issue.input === 'string'
          ? INLINE_SECRET
          : 'expected { file: … } or { env: … }',
    },
  )
  .describe('A secret reference: { file: … } or { env: … }, never the secret itself.');
export type SecretRef = z.infer<typeof secretRefSchema>;

/** Settings every app accepts. App-specific options pass through for the resolver. */
export const appSettingsSchema = z.looseObject({
  enabled: z
    .boolean()
    .default(true)
    .describe(
      'Turn the app off but keep its settings with false. Listing an app turns it on.',
    ),
  port: z
    .int()
    .min(1)
    .max(65535)
    .optional()
    .describe(
      "The host port the app's web UI is published on. The port inside the container stays the same, except for qBittorrent, where both move together.",
    ),
  version: z
    .string()
    .regex(DOCKER_TAG, 'must be a Docker image tag such as 4.0.20')
    .optional()
    .describe(
      'Run this image tag instead of the tested one. plan warns that it is an untested combination.',
    ),
  env: z
    .record(
      z.string().regex(ENV_NAME, ENV_NAME_MESSAGE),
      z.union([z.string(), secretRefSchema], { error: ENV_VALUE_MESSAGE }),
    )
    .superRefine((env, ctx) => {
      // Only references become MP_<APP>_ENV_<NAME> variables, and those are upper-cased,
      // so two references differing only by case would share one variable.
      const firstByVariable = new Map<string, string>();
      for (const name of Object.keys(env).sort(compare)) {
        if (typeof env[name] === 'string') continue;
        const variable = name.toUpperCase();
        const first = firstByVariable.get(variable);
        if (first === undefined) {
          firstByVariable.set(variable, name);
        } else {
          ctx.addIssue({
            code: 'custom',
            path: [name],
            message: `secret references need names that differ by more than case: ${first} and ${name} would share one variable`,
          });
        }
      }
    })
    .default({})
    .describe(
      'Extra environment variables for the app: strings, or secret references, which never appear in compose.yaml.',
    ),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

const stackShape = {
  version: z.literal(1).describe("The version of this file's format. Always 1."),
  timezone: z
    .string()
    .min(1)
    .default('Etc/UTC')
    .describe(
      'The timezone the apps run in, as a tz database name such as Europe/London.',
    ),
  user: z
    .strictObject({
      uid: z.int().min(0).describe('The user id.'),
      gid: z.int().min(0).describe('The group id.'),
    })
    .default({ uid: 1000, gid: 1000 })
    .describe(
      'The user and group the apps run as. They must be able to write to paths.data.',
    ),
  paths: z
    .strictObject({
      data: z
        .string()
        .regex(/^\//, 'must be an absolute path (start with /)')
        .refine(
          (path) => !path.includes(':'),
          'must not contain ":", which Docker uses to separate volume paths',
        )
        .describe(
          'The data folder for downloads and media, mounted in the apps as /data. Keep both on one filesystem inside it, so moves are instant hardlinks. An absolute path, without ":".',
        ),
    })
    .describe('Where your media lives.'),
  network: z
    .strictObject({
      bind: z
        .enum(['lan', 'localhost', 'all'])
        .default('lan')
        .describe(
          "lan: on this host's private (RFC 1918) addresses. localhost: on 127.0.0.1 only. all: on every interface, and plan warns every time. On a cloud VM, lan needs lan_subnet.",
        ),
      lan_subnet: z
        .string()
        .refine(isIpv4Cidr, 'must be an IPv4 CIDR such as 192.168.1.0/24')
        .optional()
        .describe(
          "Your LAN as an IPv4 CIDR, such as 192.168.1.0/24. Detected from this host's private addresses when left out; on a cloud VM, bind: lan needs it set.",
        ),
    })
    .default({ bind: 'lan' })
    .describe('Where the web UIs are published.'),
  security: z
    .strictObject({
      login_on_lan: z
        .boolean()
        .default(true)
        .describe(
          'Ask for a login from your own network too. false lets Sonarr, Radarr and Prowlarr skip it for addresses in the LAN subnet.',
        ),
    })
    .default({ login_on_lan: true })
    .describe('Login settings.'),
  admin: z
    .strictObject({
      username: z
        .string()
        .min(1)
        .default('admin')
        .describe('The admin user name. Not used yet (Slice 3).'),
      password: secretRefSchema
        .optional()
        .describe(
          'The admin password, as a secret reference. Checked to exist, but not used yet: from Slice 3, a password is generated when this is left out.',
        ),
    })
    .default({ username: 'admin' })
    .describe(
      "The shared admin login for the apps that have one. Not used yet: the apps' logins are set up from Slice 3.",
    ),
  media_server: z
    .enum(['jellyfin', 'plex'])
    .describe(
      'The media server, jellyfin or plex. It runs whether or not it is listed under apps.',
    ),
  plex: z
    .strictObject({
      token: secretRefSchema.describe(
        'Your Plex token, as a secret reference. Checked to exist, but not used yet: claiming the server arrives in Slice 6.',
      ),
    })
    .optional()
    .describe('Plex settings, needed when media_server is plex.'),
  vpn: z
    .strictObject({
      provider: z
        .string()
        .min(1)
        .describe('The VPN provider, by its Gluetun name, such as mullvad.'),
      private_key: secretRefSchema.describe(
        'Your WireGuard private key, as a secret reference.',
      ),
      addresses: z
        .string()
        .min(1)
        .optional()
        .describe(
          'The WireGuard address, for providers that need one, such as Mullvad. Other Gluetun settings go in apps.gluetun.env.',
        ),
    })
    .optional()
    .describe(
      "The VPN that qBittorrent's traffic goes through, by way of Gluetun. Needed while apps.qbittorrent.vpn is true.",
    ),
  // `sonarr:` with no value is YAML null; an app is enabled if it is listed.
  apps: z
    .record(
      z.string(),
      z.preprocess((value) => value ?? {}, appSettingsSchema),
    )
    .default({})
    .describe('The apps to run, by id. Listing an app runs it, even with no settings.'),
  overrides: z
    .record(
      z.string().regex(OVERRIDE_KEY, OVERRIDE_KEY_MESSAGE),
      z.union([z.string(), z.number(), z.boolean()], { error: OVERRIDE_VALUE_MESSAGE }),
    )
    .default({})
    .describe(
      'Keep mine values, by <app>.<resource>.<field>. Not used yet: drift detection arrives in Slice 4.',
    ),
  managed_by: z
    .enum(['mediaplane', 'external'])
    .default('mediaplane')
    .describe(
      'external: Mediaplane never writes this file, for when automation such as Ansible owns it. Today only init writes it, and init never overwrites. Matters from Slice 4.',
    ),
};

/** Top-level keys of stack.yaml, for "did you mean" hints. */
export const STACK_KEYS = Object.keys(stackShape);

export const stackConfigSchema = z.strictObject(stackShape).superRefine((config, ctx) => {
  if (config.media_server === 'plex' && config.plex === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['plex'],
      message: 'media_server is "plex" but plex.token is not set',
    });
  }
});
export type StackConfig = z.infer<typeof stackConfigSchema>;
