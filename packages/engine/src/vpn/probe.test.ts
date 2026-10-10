import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeExec } from '../runtime/exec';
import { tempDir } from '../testing/temp';
import { probeOutput } from '../testing/fakes';
import {
  httpAnswer,
  parseProbe,
  PROBE_SCRIPT,
  PROBE_USER,
  probeCommand,
  routeDevice,
} from './probe';

const KEY = 'fake-key-0123';
const line = (name: string, exit: number, output: string) =>
  `${name} ${String(exit)} ${Buffer.from(output).toString('base64')}`;

/**
 * Stand-ins for the image's `ip` and `curl`: both log their environment (when
 * CURL_ENV_LOG names a file), and curl logs its arguments and answers as Gluetun's
 * control server (echoing the header it read from stdin) or the echo would. The echo's
 * answer is EGRESS_BODY when that is set, even to nothing.
 */
async function stubs(dir: string): Promise<void> {
  const ip = join(dir, 'ip');
  await writeFile(
    ip,
    [
      '#!/bin/sh',
      'env >> "${CURL_ENV_LOG:-/dev/null}"',
      'echo "1.1.1.1 dev tun0  src 10.66.0.2 "',
      '',
    ].join('\n'),
  );
  const curl = join(dir, 'curl');
  await writeFile(
    curl,
    [
      '#!/bin/sh',
      'printf "%s\\n" "$*" >> "$CURL_LOG"',
      'env >> "${CURL_ENV_LOG:-/dev/null}"',
      'case "$*" in',
      '  *"-H @-"*) read -r header; printf "{\\"header\\":\\"%s\\"}\\n200" "$header" ;;',
      '  *"-o /dev/null"*) printf 401 ;;',
      '  *) printf "%s\\n" "${EGRESS_BODY-ip=203.0.113.7}" ;;',
      'esac',
      '',
    ].join('\n'),
  );
  await chmod(ip, 0o755);
  await chmod(curl, 0o755);
}

describe('PROBE_SCRIPT', () => {
  it('reports each check on a line of its own, with the key only ever on stdin', async () => {
    const dir = await tempDir('mediaplane-probe-');
    await stubs(dir);
    const log = join(dir, 'curl.log');
    const command = probeCommand(KEY, 8000, 'http://192.0.2.10/cgi-bin/ip');
    const result = await nodeExec('sh', command.args, {
      input: command.input,
      env: { PATH: `${dir}:${process.env.PATH ?? ''}`, CURL_LOG: log },
    });
    expect(result.code, result.stderr).toBe(0);
    // No secrets given: the stand-in echoes the header, to show the key reached curl.
    const probe = parseProbe(result.stdout, {});
    expect(routeDevice(probe.route)).toBe('tun0');
    expect(httpAnswer(probe.anonymous)).toEqual({ status: 401, body: '' });
    expect(httpAnswer(probe.status)).toEqual({
      status: 200,
      body: `{"header":"X-API-Key: ${KEY}"}`,
    });
    expect(probe.publicip?.exit).toBe(0);
    expect(probe.egress).toEqual({ exit: 0, output: 'ip=203.0.113.7' });
    const calls = await readFile(log, 'utf8');
    expect(calls).toContain('http://127.0.0.1:8000/v1/vpn/status');
    expect(calls).toContain('http://127.0.0.1:8000/v1/publicip/ip');
    // The URL follows --url, so a value that starts with "-" is never read as an option.
    expect(calls).toContain(
      '--max-time 10 --max-filesize 16384 --url http://192.0.2.10/cgi-bin/ip',
    );
    expect(calls).not.toContain(KEY);
    const all = calls.trim().split('\n');
    expect(all).toHaveLength(4);
    for (const call of all) {
      // No .curlrc and no proxy: -q must come first.
      expect(call.startsWith('-q '), call).toBe(true);
      expect(call, call).toContain(' --noproxy * ');
      // Any HTTP status is an answer: no curl may turn one into a failure (-f, --fail,
      // --fail-with-body, or f inside a group of short flags such as -fsS).
      for (const word of call.split(' ')) {
        expect(word, call).not.toMatch(/^--fail/);
        expect(word, call).not.toMatch(/^-[^-]*f/);
      }
    }
    // Every answer that is read, from the control server or the echo, is capped at 16 KiB.
    const read = all.filter((call) => !call.includes('-o /dev/null'));
    expect(read).toHaveLength(3);
    for (const call of read) expect(call, call).toContain('--max-filesize 16384');
  });

  it('keeps the key out of every child process environment, even past an inherited key', async () => {
    const dir = await tempDir('mediaplane-probe-');
    await stubs(dir);
    const envLog = join(dir, 'env.log');
    const command = probeCommand(KEY, 8000, 'http://192.0.2.10/cgi-bin/ip');
    // An exported variable of a name the script uses would make `read` export the key.
    const result = await nodeExec('sh', command.args, {
      input: command.input,
      env: {
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        CURL_LOG: join(dir, 'curl.log'),
        CURL_ENV_LOG: envLog,
        key: 'preset',
        url: 'preset',
        base: 'preset',
        name: 'preset',
        out: 'preset',
        code: 'preset',
      },
    });
    expect(result.code, result.stderr).toBe(0);
    const environments = await readFile(envLog, 'utf8');
    // `ip` once and curl four times, each in the environment the script gave it.
    expect(environments.match(/^PATH=/gm)).toHaveLength(5);
    expect(environments).not.toContain(KEY);
    expect(environments).not.toMatch(/^(key|url|base|name|out|code)=/m);
  });

  it('reports a check that printed nothing, with its status and no output', async () => {
    const dir = await tempDir('mediaplane-probe-');
    await stubs(dir);
    const command = probeCommand(KEY, 8000, 'http://192.0.2.10/cgi-bin/ip');
    const result = await nodeExec('sh', command.args, {
      input: command.input,
      env: {
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        CURL_LOG: join(dir, 'curl.log'),
        EGRESS_BODY: '',
      },
    });
    expect(result.code, result.stderr).toBe(0);
    // The script's line ends in a space; the parser must still see the check.
    expect(result.stdout.split('\n')).toContain('egress 0 ');
    expect(parseProbe(result.stdout, {}).egress).toEqual({ exit: 0, output: '' });
  });

  it('asks no egress question without a URL', async () => {
    const dir = await tempDir('mediaplane-probe-');
    await stubs(dir);
    const command = probeCommand(KEY, 8000, undefined);
    const result = await nodeExec('sh', command.args, {
      input: command.input,
      env: { PATH: `${dir}:${process.env.PATH ?? ''}`, CURL_LOG: join(dir, 'log') },
    });
    expect(Object.keys(parseProbe(result.stdout, {}))).toEqual([
      'route',
      'anonymous',
      'status',
      'publicip',
    ]);
  });
});

describe('probeCommand', () => {
  it('runs the script as nobody, with the key on stdin, and hides every secret it prints', () => {
    expect(probeCommand(KEY, 8000, undefined)).toEqual({
      user: PROBE_USER,
      entrypoint: 'sh',
      args: ['-c', PROBE_SCRIPT, 'vpn-check', '8000', ''],
      input: `${KEY}\n`,
      values: { controlApiKey: KEY },
    });
    const values = { MP_GLUETUN_WIREGUARD_KEY: 'fake-wireguard-key' };
    expect(probeCommand(KEY, 8000, undefined, values).values).toEqual({
      MP_GLUETUN_WIREGUARD_KEY: 'fake-wireguard-key',
      controlApiKey: KEY,
    });
    expect(PROBE_USER).toEqual({ uid: 65534, gid: 65534 });
  });
});

describe('parseProbe', () => {
  it('reads each check, and ignores what else Compose or the shell printed', () => {
    const stdout = [
      'Container x Creating',
      line('route', 2, 'RTNETLINK answers: Network is unreachable'),
      line('anonymous', 7, '000'),
      `${line('egress', 28, 'curl: (28) Connection timed out')}  `,
      'egress 0 not!base64',
    ].join('\n');
    expect(parseProbe(stdout, {})).toEqual({
      route: { exit: 2, output: 'RTNETLINK answers: Network is unreachable' },
      anonymous: { exit: 7, output: '000' },
      egress: { exit: 28, output: 'curl: (28) Connection timed out' },
    });
  });

  it('keeps a check that printed nothing, with or without the space after its status', () => {
    expect(line('egress', 0, '')).toBe('egress 0 ');
    expect(parseProbe(['route 2 ', 'egress 0 ', 'status 7'].join('\n'), {})).toEqual({
      route: { exit: 2, output: '' },
      egress: { exit: 0, output: '' },
      status: { exit: 7, output: '' },
    });
    expect(parseProbe('  egress 0 \r', {})).toEqual({ egress: { exit: 0, output: '' } });
    // A status glued to its output is not a line the script prints.
    expect(parseProbe('egress 0YQ==', {})).toEqual({});
  });

  it('masks the stack secrets in what it decodes, which run() cannot see in base64', () => {
    const wireguard = 'fake-wireguard-key';
    const stdout = [
      line('status', 0, `{"header":"X-API-Key: ${KEY}"}\n200`),
      line('publicip', 0, `{"public_ip":"203.0.113.7","note":"${wireguard}"}\n200`),
      line('egress', 0, `ip=203.0.113.7 echoed ${KEY} and ${KEY}`),
    ].join('\n');
    // The raw stdout shows no secret: run() has nothing to replace in it.
    expect(stdout).not.toContain(KEY);
    expect(stdout).not.toContain(wireguard);
    const probe = parseProbe(stdout, {
      controlApiKey: KEY,
      MP_GLUETUN_WIREGUARD_KEY: wireguard,
    });
    expect(httpAnswer(probe.status)).toEqual({
      status: 200,
      body: '{"header":"X-API-Key: ***"}',
    });
    expect(httpAnswer(probe.publicip).body).toBe(
      '{"public_ip":"203.0.113.7","note":"***"}',
    );
    expect(probe.egress?.output).toBe('ip=203.0.113.7 echoed *** and ***');
    expect(JSON.stringify(probe)).not.toContain(KEY);
    expect(JSON.stringify(probe)).not.toContain(wireguard);
  });

  it('hides the longer of two secrets whole, and ignores an empty one', () => {
    const stdout = line('egress', 0, 'fake-key-0123456789 fake-key-0123');
    expect(
      parseProbe(stdout, { short: KEY, long: 'fake-key-0123456789', empty: '' }),
    ).toEqual({ egress: { exit: 0, output: '*** ***' } });
  });
});

describe('probeOutput (the fakes)', () => {
  it('prints what parseProbe reads back', () => {
    const answers = {
      route: [0, '1.1.1.1 dev tun0 src 10.66.0.2'],
      egress: [28, 'curl: (28) Connection timed out'],
      publicip: [0, ''],
    } as const;
    expect(parseProbe(probeOutput(answers), {})).toEqual({
      route: { exit: 0, output: '1.1.1.1 dev tun0 src 10.66.0.2' },
      publicip: { exit: 0, output: '' },
      egress: { exit: 28, output: 'curl: (28) Connection timed out' },
    });
  });
});

describe('routeDevice', () => {
  it('reads the device, or nothing when there is no route', () => {
    expect(
      routeDevice({ exit: 0, output: '1.1.1.1 via 172.20.0.1 dev eth0 src x' }),
    ).toBe('eth0');
    expect(routeDevice({ exit: 2, output: 'Network is unreachable' })).toBeUndefined();
    expect(routeDevice(undefined)).toBeUndefined();
  });
});

describe('httpAnswer', () => {
  it('splits the body from the status on the last line', () => {
    expect(httpAnswer({ exit: 0, output: '{"status":"running"}\n200' })).toEqual({
      status: 200,
      body: '{"status":"running"}',
    });
    expect(httpAnswer({ exit: 7, output: '\n000' })).toEqual({ status: 0, body: '' });
    expect(httpAnswer({ exit: 0, output: 'garbled' })).toEqual({ status: 0, body: '' });
    expect(httpAnswer(undefined)).toEqual({ status: 0, body: '' });
  });
});
