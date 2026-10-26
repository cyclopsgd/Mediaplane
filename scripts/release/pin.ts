/**
 * A release's own copies of deploy/install.sh and deploy/mediaplane.compose.yaml name the
 * image that release runs, pinned by digest. In the repository both leave it out: a
 * checkout builds its own image, or is told one. The release workflow writes the copies
 * once the image is pushed and its digest known (spec §4.4, §8.2).
 */

/** An image name with its tag and digest, in characters safe in shell and YAML quotes. */
const PINNED =
  /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*:[A-Za-z0-9_][A-Za-z0-9._-]{0,127}@sha256:[0-9a-f]{64}$/;

function checked(image: string): string {
  if (!PINNED.test(image)) {
    throw new Error(
      `the release image must be pinned by digest, as name:tag@sha256:<digest>, not "${image}"`,
    );
  }
  return image;
}

/** `text`, with `from` (found exactly once) replaced by `to`, or why not. */
function once(text: string, from: string, to: string, missing: string): string {
  const at = text.indexOf(from);
  if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(missing);
  return `${text.slice(0, at)}${to}${text.slice(at + from.length)}`;
}

/** install.sh, naming `image` as the release's: it pulls that, and never builds. */
export function pinnedInstaller(text: string, image: string): string {
  const pinned = checked(image);
  return once(
    text,
    "\nrelease_image=''\n",
    `\nrelease_image='${pinned}'\n`,
    "install.sh has no release_image='' line to name the release's image on",
  );
}

/**
 * mediaplane.compose.yaml, with `image` as the default MEDIAPLANE_IMAGE: `up -d` runs it
 * unless deploy/.env names another.
 */
export function pinnedDeployment(text: string, image: string): string {
  const pinned = checked(image);
  const line =
    /^x-mediaplane-image: &mediaplane-image '\$\{MEDIAPLANE_IMAGE:\?[^'}]*\}'$/m;
  const found = line.exec(text);
  if (found === null) {
    throw new Error(
      'mediaplane.compose.yaml has no required MEDIAPLANE_IMAGE to give a default to',
    );
  }
  return once(
    text,
    found[0],
    `x-mediaplane-image: &mediaplane-image '\${MEDIAPLANE_IMAGE:-${pinned}}'`,
    'mediaplane.compose.yaml names MEDIAPLANE_IMAGE more than once',
  );
}
