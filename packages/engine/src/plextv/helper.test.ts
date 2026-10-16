import { describe, expect, it } from 'vitest';
import { fakeRuntime } from '../testing/fakes';
import { FAKE_PLEX_ACCOUNT, fakePlexTv } from '../testing/plextv';
import { thrown } from '../testing/seerr';
import { HelperError } from '../runtime/types';
import { newClientId, PlexTvError, type PlexTv } from './client';
import { answerPlexTvRequest, helperPlexTv, PLEX_TV_HELPER_SCHEMA } from './helper';

const TOKEN = FAKE_PLEX_ACCOUNT.token;
const USER = { uid: 1000, gid: 1000 };

/** The plex.tv helper's answer to `request`, parsed. */
async function answered(request: unknown, client: PlexTv): Promise<unknown> {
  return JSON.parse(
    await answerPlexTvRequest(JSON.stringify(request), client),
  ) as unknown;
}

describe('answerPlexTvRequest', () => {
  it('makes the one plex.tv call it is asked for, and answers one line of JSON', async () => {
    const { client, state } = await fakePlexTv();
    const clientId = newClientId();
    const line = await answerPlexTvRequest(
      JSON.stringify({ op: 'pin', clientId }),
      client,
    );
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trimEnd()).not.toContain('\n');
    const pin = (JSON.parse(line) as { value: { id: number; code: string } }).value;
    expect(JSON.parse(line)).toEqual({
      schema: PLEX_TV_HELPER_SCHEMA,
      ok: true,
      value: { id: 1, code: pin.code, clientId, expiresIn: 1800 },
    });
    expect(
      await answered(
        { op: 'pin-wait', pin: { ...pin, clientId, expiresIn: 1800 }, seconds: 0 },
        client,
      ),
    ).toEqual({
      schema: PLEX_TV_HELPER_SCHEMA,
      ok: true,
      value: null,
    });
    expect(await answered({ op: 'claim', token: TOKEN }, client)).toEqual({
      schema: PLEX_TV_HELPER_SCHEMA,
      ok: true,
      value: state.claims[0]?.token,
    });
    expect(await answered({ op: 'account', token: TOKEN }, client)).toMatchObject({
      ok: true,
      value: FAKE_PLEX_ACCOUNT.id,
    });
  });

  it("answers plex.tv's refusal as a failure, without the token", async () => {
    const { client } = await fakePlexTv();
    const wrong = 'wrong-plex-token-000';
    const line = await answerPlexTvRequest(
      JSON.stringify({ op: 'claim', token: wrong }),
      client,
    );
    expect(JSON.parse(line)).toEqual({
      schema: PLEX_TV_HELPER_SCHEMA,
      ok: false,
      kind: 'refused',
      status: 401,
      message: 'plex.tv refused the Plex token (HTTP 401) (GET /api/claim/token.json)',
    });
    expect(line).not.toContain(wrong);
  });

  it('refuses a request it does not take, without a call and without its values', async () => {
    const { client, state } = await fakePlexTv();
    for (const request of [
      'not json',
      JSON.stringify({ op: 'delete-everything', token: TOKEN }),
      JSON.stringify({ op: 'claim', token: TOKEN, url: 'https://elsewhere.test/' }),
      JSON.stringify({ op: 'pin', clientId: 'not-a-mediaplane-device' }),
      JSON.stringify({ op: 'claim', token: '' }),
    ]) {
      const line = await answerPlexTvRequest(request, client);
      const answer = JSON.parse(line) as { ok: boolean; kind: string; message: string };
      expect(answer).toMatchObject({ ok: false, kind: 'protocol' });
      expect(line).not.toContain(TOKEN);
    }
    expect(state.calls).toEqual([]);
  });
});

describe('helperPlexTv', () => {
  /** A runtime whose plex.tv helper runs answerPlexTvRequest against a fake plex.tv. */
  async function helped() {
    const plexTv = await fakePlexTv();
    const inputs: string[] = [];
    const calls: string[] = [];
    const runtime = fakeRuntime({
      calls,
      plexTvHelper: async (input) => {
        inputs.push(input);
        return { ok: true, stdout: await answerPlexTvRequest(input, plexTv.client) };
      },
    });
    const helper = helperPlexTv({ runtime, image: 'mediaplane:test', user: USER });
    return { ...plexTv, helper, inputs, calls };
  }

  it('runs one helper per call, the token on its standard input', async () => {
    const { helper, inputs, calls, state } = await helped();
    const claim = await helper.claimToken(TOKEN);
    expect(claim).toBe(state.claims[0]?.token);
    expect(await helper.accountId(TOKEN)).toBe(FAKE_PLEX_ACCOUNT.id);
    const pin = await helper.createPin(newClientId());
    expect(pin).toMatchObject({ id: 1, expiresIn: 1800 });
    expect(await helper.waitForPin(pin, 0)).toBeUndefined();
    state.signIn = { token: TOKEN, afterReads: 0 };
    expect(await helper.waitForPin(pin, 0)).toBe(TOKEN);
    expect(calls).toEqual(Array.from({ length: 5 }, () => 'plex-tv-helper'));
    expect(JSON.parse(inputs[0] ?? '')).toEqual({ op: 'claim', token: TOKEN });
  });

  it("gives each call the client's tries and a minute more, and the whole wait to one helper", async () => {
    const seen: number[] = [];
    const plexTv = await fakePlexTv();
    const runtime = fakeRuntime();
    const helper = helperPlexTv({
      runtime: {
        ...runtime,
        plexTvHelper: async (_image, input, _user, timeoutMs) => {
          seen.push(timeoutMs);
          return { ok: true, stdout: await answerPlexTvRequest(input, plexTv.client) };
        },
      },
      image: 'mediaplane:test',
      user: USER,
    });
    const pin = await helper.createPin(newClientId());
    plexTv.state.signIn = { token: TOKEN, afterReads: 0 };
    await helper.waitForPin(pin, 300);
    // Three tries of 30 s, 5 s and 15 s between them, and a minute for the container.
    expect(seen).toEqual([170_000, 470_000]);
  });

  it("says a helper whose time ran out couldn't reach plex.tv, as unsure, without the token", async () => {
    const runtime = fakeRuntime({
      plexTvHelper: () => {
        throw new HelperError(`the plex.tv helper did not finish within 170 s ${TOKEN}`);
      },
    });
    const helper = helperPlexTv({ runtime, image: 'mediaplane:test', user: USER });
    const error = await thrown(helper.claimToken(TOKEN));
    expect(error).toBeInstanceOf(PlexTvError);
    expect(error).toMatchObject({
      kind: 'unreachable',
      unsure: true,
      message:
        "the plex.tv helper did not finish within 170 s ***: check that this host reaches plex.tv from Docker's default bridge network",
    });
  });

  it("throws plex.tv's refusal as the helper answered it", async () => {
    const { helper } = await helped();
    const error = await thrown(helper.accountId('wrong-plex-token-000'));
    expect(error).toBeInstanceOf(PlexTvError);
    expect(error).toMatchObject({ kind: 'refused', status: 401, unsure: false });
  });

  it("says a helper that failed couldn't reach plex.tv, as unsure, without the token", async () => {
    const runtime = fakeRuntime({
      plexTvHelper: () => ({
        ok: false,
        error: `docker: network bridge not found ${TOKEN}`,
      }),
    });
    const helper = helperPlexTv({ runtime, image: 'mediaplane:test', user: USER });
    const error = await thrown(helper.claimToken(TOKEN));
    expect(error).toBeInstanceOf(PlexTvError);
    expect(error).toMatchObject({
      kind: 'unreachable',
      unsure: true,
      message: 'the plex.tv helper failed: docker: network bridge not found ***',
    });
  });

  it("refuses what it can't read, or an answer of another kind, as protocol", async () => {
    for (const stdout of [
      'not json',
      JSON.stringify({ schema: 'mediaplane.other/v1', ok: true, value: 1 }),
      `${JSON.stringify({ schema: PLEX_TV_HELPER_SCHEMA, ok: true, value: 7 })}\n`,
    ]) {
      const runtime = fakeRuntime({ plexTvHelper: () => ({ ok: true, stdout }) });
      const helper = helperPlexTv({ runtime, image: 'mediaplane:test', user: USER });
      expect(await thrown(helper.claimToken(TOKEN))).toMatchObject({
        kind: 'protocol',
        unsure: false,
      });
    }
    const runtime = fakeRuntime({
      plexTvHelper: () => ({
        ok: true,
        stdout: JSON.stringify({ schema: PLEX_TV_HELPER_SCHEMA, ok: true, value: 'x' }),
      }),
    });
    const helper = helperPlexTv({ runtime, image: 'mediaplane:test', user: USER });
    expect(await thrown(helper.createPin(newClientId()))).toMatchObject({
      kind: 'protocol',
    });
  });

  it('refuses an image name that docker would read as an option, without running it', async () => {
    const calls: string[] = [];
    const runtime = fakeRuntime({ calls });
    const helper = helperPlexTv({ runtime, image: '--privileged', user: USER });
    expect(await thrown(helper.accountId(TOKEN))).toBeInstanceOf(HelperError);
    expect(calls).toEqual([]);
  });
});
