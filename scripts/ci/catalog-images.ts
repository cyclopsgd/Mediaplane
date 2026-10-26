import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import type { AppDefinition, Arch } from '@mediaplane/engine';
import { parse, stringify } from 'yaml';
import { ranAsScript, ROOT } from '../root';

/** An app's image as the catalog pins it, as Docker takes it: repo:tag@digest. */
export function pinnedImage(def: Pick<AppDefinition, 'image'>): string {
  return `${def.image.repo}:${def.image.tag}@${def.image.digest}`;
}

/** Every catalog image that runs on `arch`, once each, sorted: what CI scans. */
export function catalogImages(defs: readonly AppDefinition[], arch: Arch): string[] {
  const images = defs.filter((def) => def.arch.includes(arch)).map(pinnedImage);
  return [...new Set(images)].sort();
}

/** One finding of scripts/ci/catalog-ignore.yaml, as Trivy's ignore file takes it. */
export interface IgnoreEntry {
  id: string;
  statement: string;
  expired_at: string;
}

/** The apps a statement names: the text after its first " in ", as "<what> in <apps>". */
const appsNamed = (statement: string): string => {
  const at = statement.indexOf(' in ');
  return at < 0 ? '' : statement.slice(at + ' in '.length);
};

const escape = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The entries that apply to `def`: those whose statement names the app, by the name the
 * catalog gives it, as a whole word. Trivy ignores an id in every image it is given an
 * ignore file for, so each image gets only the entries of its own app.
 */
export function ignoreEntriesFor(
  entries: readonly IgnoreEntry[],
  def: Pick<AppDefinition, 'name'>,
): IgnoreEntry[] {
  const name = new RegExp(`(?<![\\w-])${escape(def.name)}(?![\\w-])`, 'i');
  return entries.filter((entry) => name.test(appsNamed(entry.statement)));
}

/** scripts/ci/catalog-ignore.yaml's findings. */
export function readIgnoreEntries(file = join(ROOT, 'scripts/ci/catalog-ignore.yaml')) {
  const { vulnerabilities } = parse(readFileSync(file, 'utf8')) as {
    vulnerabilities: IgnoreEntry[];
  };
  return vulnerabilities;
}

/**
 * The ignore file for one pinned image: the entries of every app that runs it, in Trivy's
 * format. An image no app of `defs` runs is refused: a scan nobody asked for.
 */
export function ignoreFileFor(
  image: string,
  defs: readonly AppDefinition[],
  entries: readonly IgnoreEntry[],
): string {
  const apps = defs.filter((def) => pinnedImage(def) === image);
  if (apps.length === 0) throw new Error(`no catalog app runs ${image}`);
  const mine = new Set(apps.flatMap((def) => ignoreEntriesFor(entries, def)));
  return stringify({ vulnerabilities: [...mine] });
}

// pnpm tsx scripts/ci/catalog-images.ts <amd64|arm64>: one image a line.
// pnpm tsx scripts/ci/catalog-images.ts ignore <image>: that image's Trivy ignore file.
if (ranAsScript(import.meta.url, process.argv[1])) {
  const [arch, image] = process.argv.slice(2);
  if (arch === 'ignore' && image !== undefined) {
    try {
      process.stdout.write(ignoreFileFor(image, catalog, readIgnoreEntries()));
    } catch (cause) {
      console.error(`error: ${cause instanceof Error ? cause.message : String(cause)}`);
      process.exitCode = 1;
    }
  } else if (arch !== 'amd64' && arch !== 'arm64') {
    console.error('usage: catalog-images.ts <amd64|arm64> | ignore <image>');
    process.exitCode = 1;
  } else {
    for (const pinned of catalogImages(catalog, arch)) console.log(pinned);
  }
}
