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
export const secretRefSchema = z.union(
  [
    z.strictObject({ file: z.string().min(1) }),
    z.strictObject({ env: z.string().regex(ENV_NAME) }),
  ],
  {
    error: (issue) =>
      typeof issue.input === 'string'
        ? INLINE_SECRET
        : 'expected { file: … } or { env: … }',
  },
);
export type SecretRef = z.infer<typeof secretRefSchema>;

/** Settings every app accepts. App-specific options pass through for the resolver. */
export const appSettingsSchema = z.looseObject({
  enabled: z.boolean().default(true),
  port: z.int().min(1).max(65535).optional(),
  version: z
    .string()
    .regex(DOCKER_TAG, 'must be a Docker image tag such as 4.0.20')
    .optional(),
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
    .default({}),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

const stackShape = {
  version: z.literal(1),
  timezone: z.string().min(1).default('Etc/UTC'),
  user: z
    .strictObject({ uid: z.int().min(0), gid: z.int().min(0) })
    .default({ uid: 1000, gid: 1000 }),
  paths: z.strictObject({
    data: z
      .string()
      .regex(/^\//, 'must be an absolute path (start with /)')
      .refine(
        (path) => !path.includes(':'),
        'must not contain ":", which Docker uses to separate volume paths',
      ),
  }),
  network: z
    .strictObject({
      bind: z.enum(['lan', 'localhost', 'all']).default('lan'),
      lan_subnet: z
        .string()
        .refine(isIpv4Cidr, 'must be an IPv4 CIDR such as 192.168.1.0/24')
        .optional(),
    })
    .default({ bind: 'lan' }),
  security: z
    .strictObject({ login_on_lan: z.boolean().default(true) })
    .default({ login_on_lan: true }),
  admin: z
    .strictObject({
      username: z.string().min(1).default('admin'),
      password: secretRefSchema.optional(),
    })
    .default({ username: 'admin' }),
  media_server: z.enum(['jellyfin', 'plex']),
  plex: z.strictObject({ token: secretRefSchema }).optional(),
  vpn: z
    .strictObject({
      provider: z.string().min(1),
      private_key: secretRefSchema,
      addresses: z.string().min(1).optional(),
    })
    .optional(),
  // `sonarr:` with no value is YAML null; an app is enabled if it is listed.
  apps: z
    .record(
      z.string(),
      z.preprocess((value) => value ?? {}, appSettingsSchema),
    )
    .default({}),
  overrides: z
    .record(
      z.string().regex(OVERRIDE_KEY, OVERRIDE_KEY_MESSAGE),
      z.union([z.string(), z.number(), z.boolean()], { error: OVERRIDE_VALUE_MESSAGE }),
    )
    .default({}),
  managed_by: z.enum(['mediaplane', 'external']).default('mediaplane'),
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
