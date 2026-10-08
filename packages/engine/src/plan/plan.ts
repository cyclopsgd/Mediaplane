import { join, resolve } from 'node:path';
import type { Catalog } from '../catalog/types';
import { loadConfigFile } from '../config/load';
import { checkSecretRefs } from '../config/secrets';
import { hasErrors, type Diagnostic } from '../diagnostics';
import type { HostFacts } from '../host/facts';
import { renderCompose } from '../render/compose';
import { composeToYaml } from '../render/yaml';
import { resolveStack } from '../resolver/resolve';
import { diffFiles, type FileChange } from './files';

export const COMPOSE_PATH = 'generated/compose.yaml';

export interface PlanOptions {
  home: string;
  catalog: Catalog;
  host: HostFacts;
  env: NodeJS.ProcessEnv;
}

export interface PlanResult {
  /** False when any diagnostic is an error; files is then empty. */
  ok: boolean;
  changed: boolean;
  files: FileChange[];
  diagnostics: Diagnostic[];
}

/** Everything apply would do, without doing it. (Slice 1: generated files only.) */
export async function plan(options: PlanOptions): Promise<PlanResult> {
  const home = resolve(options.home);
  const loaded = await loadConfigFile(join(home, 'stack.yaml'));
  if (!loaded.ok) return failed(loaded.diagnostics);

  const diagnostics = await checkSecretRefs(loaded.config, home, options.env);
  const resolved = resolveStack(loaded.config, options.catalog, options.host, home);
  diagnostics.push(...resolved.diagnostics);
  if (resolved.stack === undefined || hasErrors(diagnostics)) return failed(diagnostics);

  const compose = composeToYaml(renderCompose(resolved.stack));
  const files = await diffFiles(home, [{ path: COMPOSE_PATH, content: compose }]);
  return {
    ok: true,
    changed: files.some((file) => file.status !== 'unchanged'),
    files,
    diagnostics,
  };
}

function failed(diagnostics: Diagnostic[]): PlanResult {
  return { ok: false, changed: false, files: [], diagnostics };
}
