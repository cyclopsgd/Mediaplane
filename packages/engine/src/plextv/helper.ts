import { z } from 'zod';
import { DOCKER_TIMEOUTS } from '../runtime/docker';
import { HelperError, type Runtime } from '../runtime/types';
import { redact, redactionValues } from '../util/redact';
import {
  PLEX_TV_TIMEOUT_MS,
  PlexTvError,
  type PlexPin,
  type PlexTv,
  type PlexTvErrorKind,
} from './client';

/** The version of the plex.tv helper's request and answer: both sides share one image. */
export const PLEX_TV_HELPER_SCHEMA = 'mediaplane.plex-tv/v1';

const pinSchema = z.strictObject({
  id: z.int(),
  code: z.string().min(1),
  clientId: z.string().regex(/^mediaplane-[0-9a-f-]{36}$/),
  expiresIn: z.number(),
});

const token = z.string().min(1);

/** What the engine asks the plex.tv helper: one plex.tv call, and nothing else. */
const requestSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('pin'), clientId: pinSchema.shape.clientId }),
  z.strictObject({
    op: z.literal('pin-wait'),
    pin: pinSchema,
    // A PIN lasts 30 minutes.
    seconds: z.int().min(0).max(1800),
  }),
  z.strictObject({ op: z.literal('claim'), token }),
  z.strictObject({ op: z.literal('account'), token }),
]);

export type PlexTvRequest = z.infer<typeof requestSchema>;

const kinds = z.enum(['refused', 'expired', 'unreachable', 'failed', 'protocol']);

const answerSchema = z.union([
  z.strictObject({
    schema: z.literal(PLEX_TV_HELPER_SCHEMA),
    ok: z.literal(true),
    value: z.union([pinSchema, z.string(), z.number(), z.null()]),
  }),
  z.strictObject({
    schema: z.literal(PLEX_TV_HELPER_SCHEMA),
    ok: z.literal(false),
    kind: kinds,
    status: z.int().optional(),
    message: z.string(),
  }),
]);

/** The secrets a request holds: what its answer, or a failure, must never show. */
function secretsOf(request: PlexTvRequest): string[] {
  return 'token' in request ? [request.token] : [];
}

/**
 * What the plex.tv helper does with what it reads on its standard input (spec §6.1): the
 * one plex.tv call it names, through `client`, and its answer as one line of JSON. A
 * request it can't read is refused without a call. A failure is an answer too (`ok:
 * false`), with what went wrong, never a token.
 */
export async function answerPlexTvRequest(
  input: string,
  client: PlexTv,
): Promise<string> {
  let data: unknown;
  try {
    data = JSON.parse(input) as unknown;
  } catch {
    return reply({ ok: false, kind: 'protocol', message: 'the request is not JSON' });
  }
  const parsed = requestSchema.safeParse(data);
  if (!parsed.success) {
    // The paths only: a value may be a token.
    const at = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || 'op'))];
    return reply({
      ok: false,
      kind: 'protocol',
      message: `the request is not one the plex.tv helper takes (at ${at.join(', ')})`,
    });
  }
  const request = parsed.data;
  try {
    return reply({ ok: true, value: await call(request, client) });
  } catch (cause) {
    if (!(cause instanceof PlexTvError)) throw cause;
    const values = redactionValues(secretsOf(request));
    return reply({
      ok: false,
      kind: cause.kind,
      ...(cause.status === undefined ? {} : { status: cause.status }),
      message: redact(cause.message, values),
    });
  }
}

async function call(
  request: PlexTvRequest,
  client: PlexTv,
): Promise<PlexPin | string | number | null> {
  switch (request.op) {
    case 'pin':
      return await client.createPin(request.clientId);
    case 'pin-wait':
      return (await client.waitForPin(request.pin, request.seconds)) ?? null;
    case 'claim':
      return await client.claimToken(request.token);
    case 'account':
      return await client.accountId(request.token);
  }
}

function reply(
  answer:
    | { ok: true; value: unknown }
    | { ok: false; kind: PlexTvErrorKind; status?: number; message: string },
): string {
  return `${JSON.stringify({ schema: PLEX_TV_HELPER_SCHEMA, ...answer })}\n`;
}

/** Who runs the plex.tv helper, and with what image: Mediaplane's own. */
export interface PlexTvHelperOptions {
  runtime: Runtime;
  /** The Mediaplane image this container runs (MEDIAPLANE_IMAGE). */
  image: string;
  /** Who the helper runs as: Mediaplane's own user. */
  user: { uid: number; gid: number };
}

/**
 * plex.tv, for Mediaplane in its image, whose container has no route out (ADR 0011): each
 * call is one run of the plex.tv helper, a throwaway container of Mediaplane's own image
 * on Docker's default bridge network, which has a route out but doesn't reach the
 * stack's networks. The request, and any token in it, goes on the helper's standard
 * input; the answer comes back on its standard output.
 */
export function helperPlexTv(options: PlexTvHelperOptions): PlexTv {
  async function ask(request: PlexTvRequest, timeoutMs: number): Promise<unknown> {
    if (options.image.startsWith('-')) {
      throw new HelperError(
        `the plex.tv helper image ${JSON.stringify(options.image)} is not an image name: it must not start with "-"`,
      );
    }
    const values = redactionValues(secretsOf(request));
    let result: Awaited<ReturnType<Runtime['plexTvHelper']>>;
    try {
      result = await options.runtime.plexTvHelper(
        options.image,
        JSON.stringify(request),
        options.user,
        timeoutMs,
      );
    } catch (cause) {
      // Its time ran out: plex.tv didn't answer, as the client inside would have said.
      if (!(cause instanceof HelperError)) throw cause;
      throw new PlexTvError(
        redact(
          `${cause.message}: check that this host reaches plex.tv from Docker's default bridge network`,
          values,
        ),
        { kind: 'unreachable' },
      );
    }
    if (!result.ok) {
      throw new PlexTvError(
        redact(`the plex.tv helper failed: ${result.error}`, values),
        { kind: 'unreachable' },
      );
    }
    let data: unknown;
    try {
      data = JSON.parse(result.stdout) as unknown;
    } catch {
      throw new PlexTvError('the plex.tv helper printed something that is not JSON', {
        kind: 'protocol',
      });
    }
    const answer = answerSchema.safeParse(data);
    if (!answer.success) {
      throw new PlexTvError(
        "the plex.tv helper printed an answer Mediaplane doesn't understand",
        { kind: 'protocol' },
      );
    }
    if (!answer.data.ok) {
      const { kind, status, message } = answer.data;
      throw new PlexTvError(redact(message, values), {
        kind,
        ...(status === undefined ? {} : { status }),
      });
    }
    return answer.data.value;
  }

  // A call's time in the helper: the client's three tries, the waits between them, and
  // the container's own start and end.
  const oneShot = 3 * PLEX_TV_TIMEOUT_MS + 20_000 + DOCKER_TIMEOUTS.query;
  const as = <T>(value: unknown, check: (v: unknown) => v is T): T => {
    if (!check(value)) {
      throw new PlexTvError("the plex.tv helper's answer is not of the kind asked for", {
        kind: 'protocol',
      });
    }
    return value;
  };
  const isString = (v: unknown): v is string => typeof v === 'string';
  return {
    async createPin(clientId) {
      const pin = pinSchema.safeParse(await ask({ op: 'pin', clientId }, oneShot));
      if (!pin.success) {
        throw new PlexTvError("the plex.tv helper's answer is not a PIN", {
          kind: 'protocol',
        });
      }
      return pin.data;
    },
    async waitForPin(pin, seconds) {
      // The helper asks plex.tv for the whole wait: a container per question would not do.
      const value = await ask({ op: 'pin-wait', pin, seconds }, seconds * 1000 + oneShot);
      return value === null ? undefined : as(value, isString);
    },
    async claimToken(t) {
      return as(await ask({ op: 'claim', token: t }, oneShot), isString);
    },
    async accountId(t) {
      return as(
        await ask({ op: 'account', token: t }, oneShot),
        (v): v is number => typeof v === 'number',
      );
    },
  };
}
