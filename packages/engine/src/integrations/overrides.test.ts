import { describe, expect, it } from 'vitest';
import type { Catalog } from '../catalog/types';
import { FAKE_LOGIN, WIRED_CATALOG, WIRING_STACK, wiringStack } from '../testing/wiring';
import {
  checkOverrides,
  desiredOf,
  isUnmanaged,
  overrideTarget,
  withOverrides,
} from './overrides';
import type { ResourceSpec, WiringContext } from './types';

/** Sonarr's login, with a field Mediaplane only checks, and one held as a list. */
const LOGIN: ResourceSpec = {
  ...FAKE_LOGIN,
  fields: ['user', 'groups', 'enabled'],
  lists: ['groups'],
  locked: { enabled: 'Sonarr keeps {resource} on' },
  desired: (ctx) => ({
    name: 'login',
    fields: { user: ctx.admin.username, groups: 'admins', enabled: true },
    secrets: { password: ctx.admin.password },
  }),
};

/** A Plex-shaped connection of Sonarr's, which a Jellyfin stack doesn't want. */
const PLEX_ONLY: ResourceSpec = {
  ...FAKE_LOGIN,
  name: 'connection_plex',
  desired: () => undefined,
};

const CATALOG: Catalog = WIRED_CATALOG.map((def) =>
  def.id === 'sonarr'
    ? { ...def, integration: { after: [], resources: [LOGIN, PLEX_ONLY] } }
    : def,
);

const ADMIN = { username: 'admin', password: 'fake-admin-password' };

/** WIRING_STACK with `overrides`, given as YAML lines. */
function stackWith(...overrides: string[]) {
  return wiringStack(
    CATALOG,
    `${WIRING_STACK}overrides:\n${overrides.map((line) => `  ${line}`).join('\n')}\n`,
  );
}

function contextOf(stack: ReturnType<typeof stackWith>): WiringContext {
  const app = stack.apps.find((a) => a.def.id === 'sonarr');
  if (app === undefined) throw new Error('no sonarr');
  return { stack, app, admin: ADMIN, keys: {} };
}

describe('desiredOf', () => {
  it("is the resource's desired(), with the overrides of its fields: Keep mine's values", () => {
    const stack = stackWith('sonarr.login.user: someone', 'sonarr.login.groups: a,b');
    expect(desiredOf(LOGIN, contextOf(stack))).toEqual({
      name: 'login',
      fields: { user: 'someone', groups: 'a,b', enabled: true },
      secrets: { password: ADMIN.password },
    });
  });

  it('leaves a locked field as the resource wants it, and wants nothing it no longer manages', () => {
    const locked = stackWith('sonarr.login.enabled: false');
    expect(desiredOf(LOGIN, contextOf(locked))?.fields.enabled).toBe(true);
    const unmanaged = stackWith('sonarr.login: unmanaged');
    expect(isUnmanaged(unmanaged, 'sonarr.login')).toBe(true);
    expect(desiredOf(LOGIN, contextOf(unmanaged))).toBeUndefined();
  });

  it('gives back what it is given when no override names the resource', () => {
    const desired = { name: 'login', fields: { user: 'admin' }, secrets: {} };
    expect(
      withOverrides(LOGIN, 'sonarr.login', desired, { 'radarr.login.user': 'x' }),
    ).toBe(desired);
  });
});

describe('overrideTarget', () => {
  it('names the resource and field a key names', () => {
    const named = overrideTarget(CATALOG, 'sonarr.login.user');
    expect(
      named.ok && [named.target.def.id, named.target.spec.name, named.target.field],
    ).toEqual(['sonarr', 'login', 'user']);
    const whole = overrideTarget(CATALOG, 'sonarr.login');
    expect(whole.ok && whole.target.field).toBeUndefined();
  });

  it('says what a key names that Mediaplane does not manage, with the closest name', () => {
    const said = (key: string) => {
      const named = overrideTarget(CATALOG, key);
      return named.ok ? 'ok' : named.diagnostic;
    };
    expect(said('sonar.login.user')).toEqual({
      severity: 'error',
      code: 'overrides.unknown',
      message: '"sonar.login.user" names no app: there is no sonar',
      path: 'overrides.sonar.login.user',
      hint: 'did you mean "sonarr"?',
    });
    expect(said('sonarr.logon.user')).toMatchObject({
      code: 'overrides.unknown',
      message:
        '"sonarr.logon.user" names nothing Mediaplane manages in sonarr: it has no logon',
      hint: 'did you mean "login"?',
    });
    expect(said('gluetun.login.user')).toMatchObject({
      code: 'overrides.unknown',
      hint: "gluetun's README lists what Mediaplane manages there",
    });
    // Field names are case-sensitive, as the apps' are: the closest is the hint.
    expect(said('sonarr.login.User')).toMatchObject({
      code: 'overrides.unmanaged-field',
      message:
        "sonarr.login.User is not a field Mediaplane manages: sonarr.login's are user, groups, enabled",
      hint: 'did you mean "user"?',
    });
    expect(said('sonarr.login.priority')).toMatchObject({
      code: 'overrides.unmanaged-field',
      hint: "the others are yours already; sonarr's README lists the managed ones",
    });
    expect(said('sonarr')).toMatchObject({ code: 'overrides.invalid' });
    expect(said('sonarr.login.user.more')).toMatchObject({ code: 'overrides.invalid' });
  });

  it('refuses a secret, and a locked field with why', () => {
    const said = (key: string) => {
      const named = overrideTarget(CATALOG, key);
      return named.ok ? 'ok' : named.diagnostic;
    };
    expect(said('sonarr.login.password')).toMatchObject({
      code: 'overrides.secret',
      message:
        "sonarr.login.password is a secret: Mediaplane checks it with sonarr's own check, and never keeps it",
    });
    expect(said('sonarr.login.enabled')).toMatchObject({
      code: 'overrides.locked',
      message: "sonarr.login.enabled can't be kept: Sonarr keeps sonarr.login on",
    });
  });
});

describe('checkOverrides', () => {
  const check = (...lines: string[]) =>
    checkOverrides(stackWith(...lines), CATALOG, { admin: ADMIN, keys: {} });

  it('takes overrides of the fields Mediaplane manages, and unmanaged resources, wanted or left', () => {
    expect(
      check(
        'sonarr.login.user: someone',
        'sonarr.login.groups: a,b',
        'sonarr.connection_plex: unmanaged',
      ),
    ).toEqual([]);
    expect(check('sonarr.login: unmanaged')).toEqual([]);
    // A field of what the stack doesn't want does nothing.
    expect(check('sonarr.connection_plex.user: someone')).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'overrides.unused',
        message:
          "sonarr.connection_plex.user does nothing: Mediaplane doesn't make sonarr.connection_plex in this stack",
      }),
    ]);
  });

  it('warns of an override of a field of a resource made unmanaged: it does nothing', () => {
    expect(check('sonarr.login: unmanaged', 'sonarr.login.user: someone')).toEqual([
      {
        severity: 'warning',
        code: 'overrides.unused',
        message:
          'sonarr.login.user does nothing: sonarr.login is unmanaged, so Mediaplane neither looks at it nor sets it',
        path: 'overrides.sonarr.login.user',
      },
    ]);
  });

  it('refuses a value of another type than the field, and a resource set to anything but unmanaged', () => {
    expect(check('sonarr.login.user: 7', 'sonarr.login: kept')).toEqual([
      {
        severity: 'error',
        code: 'overrides.type',
        message: 'sonarr.login.user must be text, as sonarr holds it, not a number',
        path: 'overrides.sonarr.login.user',
      },
      {
        severity: 'error',
        code: 'overrides.invalid',
        message:
          'sonarr.login takes only "unmanaged", to stop Mediaplane managing it; a field goes after it, as sonarr.login.<field>',
        path: 'overrides.sonarr.login',
      },
    ]);
    expect(check('sonarr.login.groups: true')).toEqual([
      expect.objectContaining({
        message:
          'sonarr.login.groups must be text, as sonarr holds it, not true or false',
      }),
    ]);
  });

  it("refuses a value its field's own rule refuses, saying why, without the value", () => {
    const ruled: Catalog = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? {
            ...def,
            integration: {
              after: [],
              resources: [
                {
                  ...LOGIN,
                  refuses: {
                    groups: (value) =>
                      value === 'fake-wrong' ? 'no group is named so' : undefined,
                  },
                },
              ],
            },
          }
        : def,
    );
    const stack = wiringStack(
      ruled,
      `${WIRING_STACK}overrides:\n  sonarr.login.groups: fake-wrong\n  sonarr.login.user: fake-wrong\n`,
    );
    expect(checkOverrides(stack, ruled, { admin: ADMIN, keys: {} })).toEqual([
      {
        severity: 'error',
        code: 'overrides.value',
        message: "sonarr.login.groups can't be used: no group is named so",
        path: 'overrides.sonarr.login.groups',
      },
    ]);
  });

  it("warns of an override for an app the stack doesn't have, and passes on what overrideTarget refuses", () => {
    const radarr = stackWith('sonarr.login.user: someone');
    const withoutSonarr = {
      ...radarr,
      apps: radarr.apps.filter((app) => app.def.id !== 'sonarr'),
    };
    expect(checkOverrides(withoutSonarr, CATALOG, { admin: ADMIN, keys: {} })).toEqual([
      expect.objectContaining({
        code: 'overrides.unused',
        message: 'sonarr.login.user does nothing: the stack has no sonarr',
      }),
    ]);
    expect(check('sonarr.login.password: x')).toEqual([
      expect.objectContaining({ code: 'overrides.secret' }),
    ]);
  });
});
