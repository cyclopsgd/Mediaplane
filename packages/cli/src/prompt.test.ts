import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { PromptCancelled, terminalAsk, terminalAskSecret } from './prompt';

/** A terminal's two ends: what the person types, and everything shown to them. */
function terminal() {
  const input = new PassThrough();
  const output = new PassThrough();
  let shown = '';
  output.on('data', (chunk: Buffer) => {
    shown += chunk.toString('utf8');
  });
  return { input, output, shown: () => shown };
}

/** The question's outcome, or "pending" if it hasn't settled within a second. */
function settled(answer: Promise<string>): Promise<string> {
  return Promise.race([
    answer.then(
      (value) => `answered ${JSON.stringify(value)}`,
      (cause: unknown) =>
        cause instanceof PromptCancelled ? 'cancelled' : String(cause),
    ),
    new Promise<string>((done) => {
      setTimeout(() => {
        done('pending');
      }, 1_000);
    }),
  ]);
}

describe('terminalAsk', () => {
  it('returns the line typed', async () => {
    const { input, output, shown } = terminal();
    const answer = terminalAsk(input, output)('Apply these changes? [y/N] ');
    input.write('yes\n');
    expect(await settled(answer)).toBe('answered "yes"');
    expect(shown()).toContain('Apply these changes? [y/N] ');
  });

  it('asks again on the same input after an answer', async () => {
    const { input, output } = terminal();
    const ask = terminalAsk(input, output);
    const first = ask('First: ');
    input.write('one\n');
    expect(await settled(first)).toBe('answered "one"');
    const second = ask('Second: ');
    input.write('two\n');
    expect(await settled(second)).toBe('answered "two"');
  });

  it('is cancelled when the input ends before an answer, and ends the line', async () => {
    const { input, output, shown } = terminal();
    const answer = terminalAsk(input, output)('Media server: ');
    input.end();
    expect(await settled(answer)).toBe('cancelled');
    expect(shown()).toMatch(/Media server: \n$/);
  });

  it.each([
    ['Ctrl-D', '\x04'],
    ['Ctrl-C', '\x03'],
  ])('is cancelled by %s on a terminal', async (_, key) => {
    const { input, output } = terminal();
    const answer = terminalAsk(input, output, true)('Media server: ');
    input.write(key);
    expect(await settled(answer)).toBe('cancelled');
  });
});

describe('terminalAskSecret', () => {
  const FAKE_KEY = `${'A'.repeat(43)}=`;

  it.each([false, true])(
    'returns what was pasted, and never shows it (terminal: %s)',
    async (isTerminal) => {
      const { input, output, shown } = terminal();
      const answer = terminalAskSecret(input, output, isTerminal)('Paste your key: ');
      input.write(`${FAKE_KEY}\r\n`);
      expect(await settled(answer)).toBe(`answered "${FAKE_KEY}"`);
      expect(shown()).toBe('Paste your key: \n');
    },
  );

  it('is cancelled by Ctrl-C, showing nothing it was given', async () => {
    const { input, output, shown } = terminal();
    const answer = terminalAskSecret(input, output, true)('Paste your key: ');
    input.write('AAAA\x03');
    expect(await settled(answer)).toBe('cancelled');
    expect(shown()).not.toContain('AAAA');
  });
});
