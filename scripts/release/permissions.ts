/**
 * What each job of `.github/workflows/release.yml` may do with its token, and nothing
 * more: `scripts/supply-chain.test.ts` and `workflow.test.ts` both hold the workflow to it.
 */
export const RELEASE_JOB_PERMISSIONS: Record<string, Record<string, string>> = {
  'release-please': { contents: 'write', issues: 'write', 'pull-requests': 'write' },
  'ci-passed': { contents: 'read', checks: 'read' },
  image: { contents: 'read', packages: 'write' },
  publish: {
    contents: 'read',
    packages: 'write',
    'id-token': 'write',
    attestations: 'write',
  },
  assets: { contents: 'read' },
  upload: { contents: 'write', 'id-token': 'write', attestations: 'write' },
};
