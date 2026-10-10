import { createInterface } from 'node:readline/promises';
import { Writable, type Readable } from 'node:stream';

/** What an `ask` throws when the person ends the input (Ctrl-D) or interrupts it (Ctrl-C). */
export class PromptCancelled extends Error {
  constructor() {
    super('cancelled at a question');
    this.name = 'PromptCancelled';
  }
}

/**
 * Ask on a terminal, one question at a time. Ending the input instead of answering cancels:
 * the answer rejects with PromptCancelled. On a terminal, readline rejects the question
 * itself (Ctrl-D, Ctrl-C); when the input simply ends, it closes and leaves the question
 * unsettled, which would leave the CLI waiting on nothing. `terminal` is readline's own
 * option, for tests; it defaults to whether `output` is a terminal.
 */
export function terminalAsk(
  input: Readable,
  output: Writable,
  terminal?: boolean,
): (question: string) => Promise<string> {
  return (question: string) => askLine(input, output, output, question, terminal);
}

/**
 * terminalAsk, for a secret: what is typed or pasted is never shown. The question goes to
 * `output`, and readline echoes into a stream that drops everything. On a terminal it is
 * still readline's own terminal (raw mode), so the terminal doesn't echo either.
 */
export function terminalAskSecret(
  input: Readable,
  output: Writable,
  terminal: boolean = (output as { isTTY?: boolean }).isTTY === true,
): (question: string) => Promise<string> {
  return async (question: string) => {
    const muted = new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    });
    output.write(question);
    const answer = await askLine(input, muted, output, '', terminal);
    // Enter was never echoed: end the question's line.
    output.write('\n');
    return answer;
  };
}

/** One question: readline writes to `echo`, and a cancel ends the line on `output`. */
function askLine(
  input: Readable,
  echo: Writable,
  output: Writable,
  question: string,
  terminal: boolean | undefined,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const prompt = createInterface({
      input,
      output: echo,
      ...(terminal === undefined ? {} : { terminal }),
    });
    let answered = false;
    const cancel = () => {
      if (answered) return;
      answered = true;
      // Closing twice does nothing, so this is safe whichever way the input ended.
      prompt.close();
      // The cursor is still after the question: what comes next starts a line.
      output.write('\n');
      reject(new PromptCancelled());
    };
    prompt.once('close', cancel);
    prompt.question(question).then((answer) => {
      if (answered) return;
      answered = true;
      prompt.close();
      resolve(answer);
    }, cancel);
  });
}
