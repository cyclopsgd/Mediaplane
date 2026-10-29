import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { docsUrl, DOCS_URL, runbookUrl, type Runbook } from './runbooks';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

describe('docsUrl', () => {
  it("is the doc's address on GitHub, for a page that is in docs/", async () => {
    expect(docsUrl('reference/stack-yaml.md')).toBe(
      'https://github.com/cyclopsgd/Mediaplane/blob/main/docs/reference/stack-yaml.md',
    );
    const runbooks: Runbook[] = [
      'app-wont-start',
      'drift-reported',
      'rebuilding-a-host',
      'vpn-down',
      'wiring-failed',
    ];
    for (const url of [
      ...runbooks.map(runbookUrl),
      docsUrl('reference/stack-yaml.md'),
      docsUrl('security/threat-model.md'),
    ]) {
      const path = url.replace(`${DOCS_URL}/`, 'docs/');
      expect((await stat(`${REPO}${path}`)).isFile(), path).toBe(true);
    }
  });
});
