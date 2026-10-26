import { catalog } from '@mediaplane/catalog';
import type { AppDefinition, Arch } from '@mediaplane/engine';
import { ranAsScript } from '../root';

/** An app's image as the catalog pins it, as Docker takes it: repo:tag@digest. */
export function pinnedImage(def: Pick<AppDefinition, 'image'>): string {
  return `${def.image.repo}:${def.image.tag}@${def.image.digest}`;
}

/** Every catalog image that runs on `arch`, once each, sorted: what CI scans. */
export function catalogImages(defs: readonly AppDefinition[], arch: Arch): string[] {
  const images = defs.filter((def) => def.arch.includes(arch)).map(pinnedImage);
  return [...new Set(images)].sort();
}

// pnpm tsx scripts/ci/catalog-images.ts <amd64|arm64>: one image a line.
if (ranAsScript(import.meta.url, process.argv[1])) {
  const arch = process.argv[2];
  if (arch !== 'amd64' && arch !== 'arm64') {
    console.error('usage: catalog-images.ts <amd64|arm64>');
    process.exitCode = 1;
  } else {
    for (const image of catalogImages(catalog, arch)) console.log(image);
  }
}
