import { parseDocument } from 'yaml';
import type { ZodError } from 'zod';
import { error, withHint, type Diagnostic } from '../diagnostics';
import { didYouMean } from '../util/did-you-mean';
import { readIfExists } from '../util/fs';
import { STACK_KEYS, stackConfigSchema, type StackConfig } from './schema';

export type LoadResult =
  { ok: true; config: StackConfig } | { ok: false; diagnostics: Diagnostic[] };

type Issue = ZodError['issues'][number];

export async function loadConfigFile(path: string): Promise<LoadResult> {
  const source = await readIfExists(path);
  if (source === undefined) {
    return {
      ok: false,
      diagnostics: [
        error('config.missing', `no stack.yaml at ${path}`, {
          hint: 'create one; the format is described in docs/design/m1-engine-cli.md §4.2',
        }),
      ],
    };
  }
  return parseConfig(source);
}

export function parseConfig(source: string): LoadResult {
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
  const result = stackConfigSchema.safeParse(data);
  if (result.success) return { ok: true, config: result.data };
  return { ok: false, diagnostics: result.error.issues.flatMap(toDiagnostics) };
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
