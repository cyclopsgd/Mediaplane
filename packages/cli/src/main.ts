import { run } from './run';

process.exitCode = await run(process.argv.slice(2), {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  env: process.env,
});
