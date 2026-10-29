import { parseDocument } from 'yaml';
import type { ZodError } from 'zod';
import { error, warning, withHint, type Diagnostic } from '../diagnostics';
import { docsUrl } from '../runbooks';
import { didYouMean } from '../util/did-you-mean';
import { readIfExists } from '../util/fs';
import { MIGRATIONS, migrateData, STACK_VERSION, type Migration } from './migrations';
import { STACK_KEYS, stackConfigSchema, type StackConfig } from './schema';

export type LoadResult =
  | {
      ok: true;
      config: StackConfig;
      /** Warnings, when there are some: an older version, read in memory. */
      diagnostics?: Diagnostic[];
    }
  | { ok: false; diagnostics: Diagnostic[] };

const VERSION_HINTS = {
  'config.newer-version':
    'update Mediaplane to a release that reads it, or go back to the stack.yaml this one wrote',
  'config.unknown-version': `set version: ${String(STACK_VERSION)}, the version this Mediaplane writes, if the rest of the file is in its format`,
} as const;

type Issue = ZodError['issues'][number];

export async function loadConfigFile(
  path: string,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<LoadResult> {
  const source = await readIfExists(path);
  if (source === undefined) {
    return {
      ok: false,
      diagnostics: [
        error('config.missing', `no stack.yaml at ${path}`, {
          hint: `run "mediaplane init" to write one, or pass --home with the Mediaplane home; its format: ${docsUrl('reference/stack-yaml.md')}`,
        }),
      ],
    };
  }
  return parseConfig(source, migrations);
}

/**
 * `source`, a stack.yaml, validated. An older version is migrated in memory, with a
 * warning: only `mediaplane migrate` rewrites the file (spec §5 step 2).
 */
export function parseConfig(
  source: string,
  migrations: readonly Migration[] = MIGRATIONS,
): LoadResult {
  const doc = parseDocument(source, { prettyErrors: true });
  if (doc.errors.length > 0) {
    return {
      ok: false,
      diagnostics: doc.errors.map((e) =>
        error('config.yaml-syntax', withoutSource(e.message)),
      ),
    };
  }
  let data: unknown;
  try {
    data = doc.toJS() as unknown;
  } catch (cause) {
    // e.g. "Excessive alias count indicates a resource exhaustion attack"
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, diagnostics: [error('config.yaml-syntax', message)] };
  }
  const warnings: Diagnostic[] = [];
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const migrated = migrateData(data as Record<string, unknown>, migrations);
    if (!migrated.ok) {
      return {
        ok: false,
        diagnostics: [
          error(migrated.code, migrated.message, {
            path: 'version',
            hint: VERSION_HINTS[migrated.code],
          }),
        ],
      };
    }
    if (migrated.applied.length > 0) {
      warnings.push(
        warning(
          'config.old-version',
          `stack.yaml is version ${String(migrated.from)}: Mediaplane reads it as version ${String(STACK_VERSION)} (${migrated.applied.join('; ')}), and leaves the file as it is`,
          { hint: 'run mediaplane migrate to rewrite it, keeping its comments' },
        ),
      );
    }
    data = migrated.data;
  }
  const result = stackConfigSchema.safeParse(data);
  if (result.success) {
    return {
      ok: true,
      config: result.data,
      ...(warnings.length === 0 ? {} : { diagnostics: warnings }),
    };
  }
  // The old-version warning first: the errors name the keys it was migrated to.
  return {
    ok: false,
    diagnostics: [...warnings, ...result.error.issues.flatMap(toDiagnostics)],
  };
}

/** yaml's pretty errors append the offending source line, which may hold a secret. */
function withoutSource(message: string): string {
  return (message.split('\n')[0] ?? message).replace(/:$/, '');
}

function toDiagnostics(issue: Issue): Diagnostic[] {
  const path = issue.path.map(String).join('.');
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => {
      const keyPath = path === '' ? key : `${path}.${key}`;
      const suggestion = path === '' ? didYouMean(key, STACK_KEYS) : undefined;
      return error('config.unknown-key', `unknown key "${keyPath}"`, {
        path: keyPath,
        ...withHint(
          suggestion === undefined ? undefined : `did you mean "${suggestion}"?`,
        ),
      });
    });
  }
  if (issue.code === 'invalid_key') {
    // A record key failed its schema. Zod's own message ("Invalid key in record") says
    // nothing, so report the inner key issue(s) at the path of the offending key.
    return issue.issues.map((inner) =>
      error('config.invalid', `${path}: ${inner.message}`, { path }),
    );
  }
  if (path === '') return [error('config.invalid', issue.message)];
  return [error('config.invalid', `${path}: ${issue.message}`, { path })];
}
