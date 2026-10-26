import { catalog } from '@mediaplane/catalog';
import type { AppDefinition } from '@mediaplane/engine';
import { ranAsScript } from '../root';

const byName = (a: AppDefinition, b: AppDefinition): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/**
 * The release notes' "tested app versions" (spec §8.2): Mediaplane's image, then each
 * app's, as the catalog pins it, one item each, so it reads on a phone too.
 */
export function testedApps(defs: readonly AppDefinition[], image: string): string {
  const apps = [...defs]
    .sort(byName)
    .flatMap((def) => [
      `- **${def.name}** ${def.image.tag}`,
      `  \`${def.image.repo}@${def.image.digest}\``,
    ]);
  return [
    '## Tested app versions',
    '',
    "This release runs these images, pinned by tag and digest. CI's end-to-end tests ran them on amd64 and arm64 for the commit this release was cut from. Plex's claim with a real plex.tv account runs in the nightly Plex test instead.",
    '',
    `- **Mediaplane** \`${image}\``,
    ...apps,
    '',
  ].join('\n');
}

// pnpm --silent exec tsx scripts/release/tested-apps.ts <Mediaplane's image>
if (ranAsScript(import.meta.url, process.argv[1])) {
  const image = process.argv[2];
  if (image === undefined || image === '') {
    console.error("usage: tested-apps.ts <Mediaplane's image>");
    process.exitCode = 1;
  } else {
    process.stdout.write(testedApps(catalog, image));
  }
}
