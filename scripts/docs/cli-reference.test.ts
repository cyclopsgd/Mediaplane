import { describe, expect, it } from 'vitest';
import { renderCliReference } from './cli-reference';

describe('renderCliReference', () => {
  const text = renderCliReference();

  it('documents every command with its options and exit codes', () => {
    for (const name of ['plan', 'apply', 'status', 'history', 'init']) {
      expect(text).toContain(`## \`mediaplane ${name}\``);
    }
    expect(text).toContain(
      '| `--home <dir>` | Mediaplane home directory (default: "/opt/mediaplane") |',
    );
    expect(text).toContain('- 2: apply would change something');
    expect(text).toContain('| `MEDIAPLANE_IMAGE` |');
  });

  it("leaves out the host helper's command, and nothing in it depends on this machine", () => {
    expect(text).not.toContain('host-report');
    expect(text).toContain("(default: this machine's timezone)");
  });
});
