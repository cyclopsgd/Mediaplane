import { spawn } from 'node:child_process';

export interface ExecOptions {
  input?: string | undefined;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Stop the command (SIGTERM) and reject with code "ETIMEDOUT" after this many ms. */
  timeoutMs?: number;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Exec = (
  command: string,
  args: readonly string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

/** Run a command without a shell, so arguments are never interpreted. */
export const nodeExec: Exec = (command, args, options = {}) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], {
      env: options.env ?? process.env,
      cwd: options.cwd,
    });
    let stdout = '';
    let stderr = '';
    const timeoutMs = options.timeoutMs;
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            child.kill('SIGTERM');
            reject(
              Object.assign(
                new Error(`${command} timed out after ${String(timeoutMs / 1000)}s`),
                { code: 'ETIMEDOUT' },
              ),
            );
          }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.on('error', () => {
      // The command exited before reading its input; its exit code tells the story.
    });
    child.stdin.end(options.input ?? '');
  });
