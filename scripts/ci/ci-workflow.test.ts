import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROOT } from '../root';

interface Job {
  env?: Record<string, string>;
  steps: { run?: string; env?: Record<string, string> }[];
}
const text = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const ci = parse(text) as {
  env?: Record<string, string>;
  jobs: Record<string, Job>;
};

describe('the catalog scan switch in ci.yml (spec §7.2(7))', () => {
  it("sets CATALOG_SCAN to report on the catalog's image job, the owner's decision of 2026-10-27", () => {
    expect(ci.jobs['catalog-images']?.env).toEqual({ CATALOG_SCAN: 'report' });
  });

  it('runs scan-catalog.sh for both architectures from that job', () => {
    const runs = (ci.jobs['catalog-images']?.steps ?? []).flatMap((step) =>
      step.run === undefined ? [] : [step.run],
    );
    expect(runs).toContain('scripts/ci/scan-catalog.sh amd64');
    expect(runs).toContain('scripts/ci/scan-catalog.sh arm64');
  });

  it("leaves Mediaplane's own image scan failing on a fixable critical: no switch there", () => {
    const image = ci.jobs.image;
    expect(image?.steps.some((step) => step.run?.includes('scan-image.sh'))).toBe(true);
    expect(ci.env).toBeUndefined();
    for (const [name, job] of Object.entries(ci.jobs)) {
      if (name !== 'catalog-images') {
        expect(JSON.stringify(job), name).not.toContain('CATALOG_SCAN');
      }
    }
  });

  it('is the only place that sets the switch in the workflow', () => {
    expect(text.match(/^\s+CATALOG_SCAN: /gm)).toHaveLength(1);
  });
});
