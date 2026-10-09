import { readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { catalog } from './index';

const appFolders = (await readdir(new URL('.', import.meta.url), { withFileTypes: true }))
  .filter((e) => e.isDirectory() && !e.name.startsWith('_') && e.name !== 'node_modules')
  .map((e) => e.name)
  .sort();

const NO_OPTIONS = z.strictObject({});

describe('catalog', () => {
  it('registers every app folder exactly once, sorted by id', () => {
    expect(catalog.map((app) => app.id)).toEqual(appFolders);
  });

  describe.each(catalog.map((app) => [app.id, app] as const))('%s', (_id, app) => {
    it('is pinned by exact tag and multi-arch digest', () => {
      expect(app.image.tag).not.toBe('latest');
      expect(app.image.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('supports amd64 and arm64', () => {
      expect(app.arch).toEqual(expect.arrayContaining(['amd64', 'arm64']));
    });

    it('has unique port names', () => {
      const names = app.ports.map((port) => port.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('has unique container ports per protocol', () => {
      const listeners = app.ports.map(
        (port) => `${port.protocol ?? 'tcp'}/${port.container}`,
      );
      expect(new Set(listeners).size).toBe(listeners.length);
    });

    it('only injects secrets it declares', () => {
      for (const step of app.credentials) {
        if (step.step === 'env') expect(Object.keys(app.secrets)).toContain(step.secret);
      }
    });

    it('names no secret env<Name>, which would collide with apps.<id>.env', () => {
      // secretEnvName(id, 'envToken') is MP_<ID>_ENV_TOKEN, the same variable as
      // apps.<id>.env.TOKEN (appEnvSecretName).
      for (const name of Object.keys(app.secrets)) expect(name).not.toMatch(/^env[A-Z]/);
    });

    it('accepts empty options and implies only catalog apps', () => {
      const options = (app.options ?? NO_OPTIONS).parse({});
      for (const implied of app.implies?.(options) ?? []) {
        expect(catalog.map((other) => other.id)).toContain(implied);
      }
    });
  });
});
