import { describe, expect, it } from 'vitest';
import { nodeExec } from './exec';

const node = process.execPath;

describe('nodeExec', () => {
  it('passes input on stdin and captures stdout', async () => {
    const result = await nodeExec(node, ['-e', 'process.stdin.pipe(process.stdout)'], {
      input: 'hello',
    });
    expect(result).toEqual({ code: 0, stdout: 'hello', stderr: '' });
  });

  it('reports the exit code and stderr', async () => {
    const result = await nodeExec(node, ['-e', 'console.error("nope"); process.exit(3)']);
    expect(result).toMatchObject({ code: 3, stderr: 'nope\n' });
  });

  it('passes arguments literally, without a shell', async () => {
    const result = await nodeExec(node, [
      '-e',
      'console.log(process.argv[1])',
      '$(echo hi)',
    ]);
    expect(result.stdout).toBe('$(echo hi)\n');
  });

  it('uses the given environment', async () => {
    const result = await nodeExec(node, ['-e', 'console.log(process.env.FAKE_X)'], {
      env: { FAKE_X: 'fake-value' },
    });
    expect(result.stdout).toBe('fake-value\n');
  });

  it('rejects when the command does not exist', async () => {
    await expect(nodeExec('mediaplane-no-such-command', [])).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
