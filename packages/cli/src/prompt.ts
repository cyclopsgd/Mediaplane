import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

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
  return (question: string) =>
    new Promise<string>((resolve, reject) => {
      const prompt = createInterface({
        input,
        output,
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
