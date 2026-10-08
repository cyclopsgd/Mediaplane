export type Severity = 'error' | 'warning';

/** A problem found while loading, resolving or planning, written for the user. */
export interface Diagnostic {
  severity: Severity;
  /** Stable machine-readable identifier, e.g. "config.unknown-key". */
  code: string;
  message: string;
  /** Dotted path into stack.yaml, e.g. "apps.qbittorrent.vpn". */
  path?: string;
  /** What the user can do about it. */
  hint?: string;
}

type Extra = Partial<Pick<Diagnostic, 'path' | 'hint'>>;

export function error(code: string, message: string, extra: Extra = {}): Diagnostic {
  return { severity: 'error', code, message, ...extra };
}

export function warning(code: string, message: string, extra: Extra = {}): Diagnostic {
  return { severity: 'warning', code, message, ...extra };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

/** Spread into a diagnostic's extras: `{ path, ...withHint(maybeHint) }`. */
export function withHint(hint: string | undefined): { hint?: string } {
  return hint === undefined ? {} : { hint };
}
