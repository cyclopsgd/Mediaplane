import { createInterface } from 'node:readline/promises';
import { run } from './run';

// A reader that exits early (`mediaplane plan | head -1`) closes the pipe. That is not
// a failure of ours, so keep the exit code `run()` sets instead of crashing on EPIPE.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EPIPE') throw error;
});

const interactive = process.stdin.isTTY && process.stdout.isTTY;

process.exitCode = await run(process.argv.slice(2), {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  env: process.env,
  ...(interactive
    ? {
        ask: async (question: string) => {
          const prompt = createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          try {
            return await prompt.question(question);
          } finally {
            prompt.close();
          }
        },
      }
    : {}),
});
