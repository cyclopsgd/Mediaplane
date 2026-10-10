import { isIP } from 'node:net';
import { z } from 'zod';
import { portKey } from '../preflight/checks';
import { nodeProbe, type HostProbe, type PathStat } from '../preflight/probe';
import { HelperError } from '../runtime/types';
import { fetchEgress, isEgressUrl, type EgressResult } from '../vpn/egress';
import { detectHostFacts, type HostFacts } from './facts';

/** The version of the host helper's report: the helper and the engine share one image. */
export const HOST_REPORT_SCHEMA = 'mediaplane.host-report/v1';

/** A host path the engine asks about (`key`), and where the helper sees it (`at`). */
const lookupSchema = z.strictObject({
  key: z.string().regex(/^\//),
  at: z.string().regex(/^\//),
});

const hostRequestSchema = z.strictObject({
  facts: z.boolean(),
  stat: z.array(lookupSchema),
  free: z.array(lookupSchema),
  ports: z.array(
    z.strictObject({
      address: z.string().min(1),
      port: z.int().min(1).max(65535),
      protocol: z.enum(['tcp', 'udp']),
    }),
  ),
  /** An IP-echo service to ask which address the host comes from (vpn-check). */
  egress: z.string().refine(isEgressUrl, 'must be an http or https URL').optional(),
});

/** What the engine asks the host helper. */
export type HostRequest = z.infer<typeof hostRequestSchema>;

// dev and ino can exceed 2^53, so they are plain numbers; both sides round them alike.
const pathStatSchema = z.strictObject({
  isDirectory: z.boolean(),
  isCharacterDevice: z.boolean(),
  uid: z.int(),
  gid: z.int(),
  mode: z.int(),
  dev: z.number(),
  ino: z.number(),
});

const hostFactsSchema = z.strictObject({
  arch: z.enum(['amd64', 'arm64']),
  privateAddresses: z.array(z.strictObject({ address: z.string(), cidr: z.string() })),
  cloud: z.string().optional(),
});

const hostReportSchema = z.strictObject({
  schema: z.literal(HOST_REPORT_SCHEMA),
  facts: hostFactsSchema.optional(),
  stat: z.record(z.string(), pathStatSchema.nullable()),
  free: z.record(z.string(), z.number().nullable()),
  ports: z.record(z.string(), z.boolean().nullable()),
  egress: z
    .union([
      z.strictObject({
        ok: z.literal(true),
        // A stale or broken helper must not hand the engine something that isn't one.
        address: z.string().refine((a) => isIP(a) !== 0, 'must be an IP address'),
      }),
      z.strictObject({ ok: z.literal(false), error: z.string() }),
    ])
    .optional(),
});

/**
 * What the host helper saw. stat and free are keyed by host path, ports by portKey().
 * null: the path does not exist, or (free space, ports) the helper can't tell.
 */
export type HostReport = z.infer<typeof hostReportSchema>;

/**
 * The host helper's answer (spec §4.2). It runs in a throwaway container of the Mediaplane
 * image on the host network, so the network interfaces, firmware and free ports it sees
 * are the host's. It sees host paths where the engine mounted them (`at`).
 */
export async function collectHostReport(
  request: HostRequest,
  probe: HostProbe = nodeProbe,
  facts: () => HostFacts = () => detectHostFacts(),
  egress: (url: string) => Promise<EgressResult> = fetchEgress,
): Promise<HostReport> {
  const stat: Record<string, PathStat | null> = {};
  for (const { key, at } of request.stat) stat[key] = (await probe.stat(at)) ?? null;
  const free: Record<string, number | null> = {};
  for (const { key, at } of request.free) free[key] = (await probe.freeBytes(at)) ?? null;
  const ports: Record<string, boolean | null> = {};
  for (const { address, port, protocol } of request.ports) {
    ports[portKey(protocol, address, port)] =
      (await probe.portFree(address, port, protocol)) ?? null;
  }
  return {
    schema: HOST_REPORT_SCHEMA,
    ...(request.facts ? { facts: facts() } : {}),
    stat,
    free,
    ports,
    ...(request.egress === undefined ? {} : { egress: await egress(request.egress) }),
  };
}

/** The helper's side: the request it was given on its command line. */
export function parseHostRequest(text: string): HostRequest {
  const parsed = hostRequestSchema.safeParse(parseJson(text));
  if (!parsed.success) {
    throw new Error(
      `the host helper was given a request it cannot read: ${firstIssue(parsed.error)}`,
    );
  }
  return parsed.data;
}

/** The engine's side: the report on the last line of the helper's output. */
export function parseHostReport(stdout: string): HostReport {
  const last = stdout.trim().split('\n').at(-1) ?? '';
  const parsed = hostReportSchema.safeParse(parseJson(last));
  if (!parsed.success) {
    throw new HelperError(
      `the host helper printed a report Mediaplane cannot read: ${firstIssue(parsed.error)}`,
    );
  }
  return parsed.data;
}

/** JSON, or undefined (which every schema above rejects) for anything that isn't. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return 'no details';
  return issue.path.length === 0
    ? issue.message
    : `${issue.path.join('.')}: ${issue.message}`;
}
