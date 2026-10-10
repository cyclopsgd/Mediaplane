import { describe, expect, it } from 'vitest';
import { renderCliReference } from './cli-reference';

describe('renderCliReference', () => {
  const text = renderCliReference();

  it('documents every command with its options and exit codes', () => {
    for (const name of ['plan', 'apply', 'status', 'history', 'init', 'credentials']) {
      expect(text).toContain(`## \`mediaplane ${name}\``);
    }
    expect(text).toContain(
      '| `--home <dir>` | Mediaplane home directory (default: "/opt/mediaplane") |',
    );
    expect(text).toContain('- 2: apply would change something');
  });

  // A table would scroll sideways on a phone: the descriptions are long.
  it('lists the environment variables, one item each', () => {
    const section = text.slice(text.indexOf('## Environment variables'));
    expect(section).toContain(
      '- `MEDIAPLANE_IMAGE`: Set by mediaplane.compose.yaml in the Mediaplane container',
    );
    expect(section).toContain('It must be mediaplane-\\<name>, such as mediaplane-dev.');
    expect(section).not.toContain('|');
  });

  it("leaves out the host helper's command, and nothing in it depends on this machine", () => {
    expect(text).not.toContain('host-report');
    expect(text).toContain("(default: this machine's timezone)");
  });
});
