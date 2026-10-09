# M1 Slice 2a: plan against a real host — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mediaplane plan` talks to the real Docker on the host and reports exactly
what `apply` would do. It checks the host first, then shows the generated files, the
container changes and the secrets to generate. It still writes nothing.

**What the host checks cover:**

- the Docker and Compose versions;
- free disk space;
- the data folder: it must exist, be writable and sit on one filesystem;
- the devices the apps need;
- free ports;
- a refusal to publish on a cloud VM's private address.

**Container changes** are predicted with Compose's own config hash, so they match what
Compose will actually do. This slice also lands the Slice 1 review items marked for S2.

**Architecture:**

- **Runtime.** Every Docker call goes through one `Runtime`: `versions`,
  `configHashes` and `containers`. It runs the `docker` CLI with an argument array,
  never through a shell.
- **Host probe.** Every host check (`stat`, `statfs`, port checks) goes through a
  `HostProbe`.
- **Fakes.** Both have in-memory fakes, so unit tests never need Docker. The CLI gets
  them through an optional `deps` argument.
- **Container prediction.** `plan()` feeds the rendered, unwritten `compose.yaml` to
  `docker compose -f - config --hash '*'`, passing secret values through the
  subprocess environment. It then compares each service's hash with the
  `com.docker.compose.config-hash` label on the running containers.
- **Secrets.** Secret values are only ever read here. Writing them is Slice 2b.

**Tech Stack:** as Slice 1 (Node 24, pnpm 10.15.0, TypeScript 6.0, Zod 4, `yaml` 2,
jsdiff 9, Commander 15, Vitest 4), plus Node's `child_process`, `net`, `dgram` and
`fs.statfs`. No new npm dependencies.

**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular
§4.1, §4.2, §5 (stages 3–5) and §7.2. Slice context:
[`docs/plans/m1-roadmap.md`](m1-roadmap.md), especially "Inputs for later slices", S2.

## Global Constraints

Everything in Slice 1's Global Constraints still holds
(`docs/plans/m1-s1-pure-core.md`): fake values only, neutral framing, determinism,
`compare` instead of `localeCompare`, Prettier `printWidth: 90`, and "never push".
These are added:

- **`plan` writes nothing.** No file or directory under the Mediaplane home is created
  or changed by `plan`, and a test proves it (Task 8).
- **Docker is only reached through the `Runtime`** (`packages/engine/src/runtime/`).
  Test code may also call `nodeExec('docker', …)` directly when it needs a Compose
  operation the engine doesn't have yet, such as `create` in Task 9.
  - The `docker` CLI is always spawned with an argument array, with `cwd: '/'` and no
    shell.
  - Every Compose call passes `-p <project>`. Calls that read compose files also pass
    `--project-directory <home>`.
- **Version floors:** Docker Engine `24.0.0` or newer, Docker Compose `2.24.0` or newer.
- **Compose project name:** `PROJECT_NAME` (`mediaplane`) by default.
  `MEDIAPLANE_COMPOSE_PROJECT` overrides it. It exists so end-to-end tests never touch
  a real stack.
- **Empty environment variables count as unset:** `MEDIAPLANE_HOME=""` means the
  default home.
- **Secret values never appear** in diagnostics, error messages, logs, the plan output
  or the JSON output. Names such as `sonarr.apiKey` are fine.
- **Unit tests never need Docker**, except the spawned-process tests in
  `packages/cli/src/main.test.ts`, which run the real CLI. Real-Docker scenarios live in
  `test/e2e/` (`pnpm test:e2e`).
- **Before every commit, run** `pnpm format && pnpm lint && pnpm typecheck && pnpm test`.
  The pre-commit hook runs gitleaks.

## File structure (new and changed in this slice)

```
packages/engine/src/
├── config/schema.ts        (changed) tag/CIDR/path validation, secret refs in apps.<id>.env
├── config/load.ts          (changed) YAML errors without source excerpts, alias-bomb diagnostic
├── config/secrets.ts       (changed) secretRefs includes apps.<id>.env references
├── util/fs.ts              (changed) I/O errors name the file
├── host/facts.ts           (changed) cloud detection (DMI), inSubnet, wider interface deny-list
├── resolver/resolve.ts     (changed) cloud-safe "lan", lan_subnet filtering, namespace port conflicts
├── render/compose.ts       (changed) appEnvSecretName, env refs, literal() on image
├── render/yaml.ts          (changed) composeHeader(home): exact eject command
├── secrets/store.ts        (new) read state/secrets.json
├── secrets/values.ts       (new) secretsToGenerate, secretValues
├── runtime/types.ts        (new) Runtime, ContainerState, HashesResult, RuntimeError
├── runtime/exec.ts         (new) nodeExec: spawn without a shell
├── runtime/docker.ts       (new) createDockerRuntime, parseHashes, parseContainers
├── preflight/probe.ts      (new) HostProbe, PathStat, nodeProbe
├── preflight/checks.ts     (new) runPreflight and its checks
├── plan/containers.ts      (new) planContainers, ownPorts
├── plan/plan.ts            (changed) preflight + secrets + containers
├── testing/fakes.ts        (new) fakeRuntime, fakeProbe, running, fakeHash
└── testing/index.ts        (new) test-only entry point: @mediaplane/engine/testing
catalog/gluetun/app.ts      (changed) declares its control port 8000 (unpublished)
packages/cli/src/run.ts     (changed) deps injection, project override, empty-env handling
packages/cli/src/output.ts  (changed) containers + secrets in the plan, JSON error envelope
test/e2e/plan.e2e.test.ts   (new) real Docker, real catalog, and the hash-label check
vitest.e2e.config.ts        (new)
package.json                (changed) test:e2e, workspace devDependencies for test/
.github/workflows/ci.yml    (changed) e2e job
docs/adr/0010-predict-container-changes-with-compose-hashes.md (new)
```

**Tasks:**

1. Config and I/O hardening.
2. Cloud detection and a wider interface deny-list.
3. Cloud-safe binding and namespace port conflicts.
4. Secret references in `apps.<id>.env`.
5. The secrets store and secret values.
6. The Docker runtime and the eject command.
7. Preflight checks.
8. Container plan, `plan()` against the runtime, and the CLI.
9. End-to-end tests, the CI job and docs.

**Deferred to Slice 2b:** writing anything. That covers:

- key generation;
- writing `state/secrets.json` and `generated/.env`;
- the lock and history;
- the `apply`, `status`, `history` and `init` commands;
- pulling images;
- `up --wait`;
- the appdata ownership helper;
- ADR 0004.

The Mediaplane image, the socket proxy and host detection from inside a container (ADR
0008) are Slice 2c.

---

### Task 1: Config and I/O hardening

**Files:**
- Modify: `packages/engine/src/config/schema.ts`, `packages/engine/src/config/load.ts`,
  `packages/engine/src/util/fs.ts`
- Test: `packages/engine/src/config/load.test.ts`; create
  `packages/engine/src/util/fs.test.ts`

**Interfaces:**
- **Consumes:** the existing `parseConfig`, `readIfExists` and `diagnosticsOf` helper
  (in `load.test.ts`), and the `MINIMAL` fixture.
- **Produces:**
  - **Same signatures as before.** New validation messages, listed below.
  - **`readIfExists`** now throws `Error("cannot read <path> (<CODE>)")`, with the
    original error as its `cause`, for any failure other than ENOENT. For EACCES and
    EPERM the message adds `: check that the user running Mediaplane can read it`.
  - **YAML syntax diagnostics** carry only the first line of the parser's message.
    They never include the source excerpt.

The new validation messages are:

| Field | Message |
|---|---|
| `apps.<id>.version` | `must be a Docker image tag such as 4.0.20` |
| `paths.data` containing `:` | `must not contain ":", which Docker uses to separate volume paths` |
| `network.lan_subnet` | `must be an IPv4 CIDR such as 192.168.1.0/24`, now with each octet checked to be at most 255 |

- [ ] **Step 1: Write the failing tests**

Add these tests to the `describe('parseConfig', …)` block in
`packages/engine/src/config/load.test.ts`:

```ts
  it('rejects subnets with out-of-range octets', () => {
    const [diagnostic] = diagnosticsOf(`${MINIMAL}network: { lan_subnet: 999.168.1.0/24 }\n`);
    expect(diagnostic).toMatchObject({ code: 'config.invalid', path: 'network.lan_subnet' });
  });

  it('rejects data paths containing ":"', () => {
    const [diagnostic] = diagnosticsOf(MINIMAL.replace('/srv/data', '/srv/data:/x'));
    expect(diagnostic).toMatchObject({ code: 'config.invalid', path: 'paths.data' });
    expect(diagnostic?.message).toContain('must not contain ":"');
  });

  it('rejects app versions that are not Docker tags', () => {
    const [diagnostic] = diagnosticsOf(`${MINIMAL}apps:\n  sonarr: { version: "4.0 latest" }\n`);
    expect(diagnostic).toMatchObject({ code: 'config.invalid', path: 'apps.sonarr.version' });
    expect(diagnostic?.message).toContain('must be a Docker image tag');
  });

  it('does not echo the offending source line in YAML syntax errors', () => {
    const diagnostics = diagnosticsOf('version: 1\nvpn: { private_key: "fake-leaked-value }\n');
    expect(diagnostics[0]?.code).toBe('config.yaml-syntax');
    expect(diagnostics[0]?.message).toMatch(/line \d+, column \d+$/);
    expect(JSON.stringify(diagnostics)).not.toContain('fake-leaked-value');
  });

  it('turns an alias bomb into a diagnostic instead of throwing', () => {
    const bomb = [
      'a: &a [x,x,x,x,x,x,x,x,x]',
      'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
      'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
      'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
      'e: [*d,*d,*d,*d,*d,*d,*d,*d,*d]',
      '',
    ].join('\n');
    const [diagnostic] = diagnosticsOf(bomb);
    expect(diagnostic?.code).toBe('config.yaml-syntax');
    expect(diagnostic?.message).toContain('alias');
  });
```

Create `packages/engine/src/util/fs.test.ts`:

```ts
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readIfExists } from './fs';

describe('readIfExists', () => {
  it('returns undefined for a file that does not exist', async () => {
    expect(await readIfExists('/nonexistent/mediaplane/file')).toBeUndefined();
  });

  it('names the file when a read fails for another reason', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-fs-'));
    await expect(readIfExists(dir)).rejects.toThrow(`cannot read ${dir} (EISDIR)`);
  });

  // root can read anything, so there is nothing to test when running as root.
  it.skipIf(process.getuid?.() === 0)(
    'says what to check when permission is denied',
    async () => {
      const file = join(await mkdtemp(join(tmpdir(), 'mediaplane-fs-')), 'stack.yaml');
      await writeFile(file, 'version: 1\n');
      await chmod(file, 0o000);
      await expect(readIfExists(file)).rejects.toThrow(
        `cannot read ${file} (EACCES): check that the user running Mediaplane can read it`,
      );
    },
  );
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/config/load.test.ts packages/engine/src/util/fs.test.ts`

Expected: the five new `parseConfig` tests fail, along with "names the file…" and
"says what to check…". Each fails for a specific reason:

- **Out-of-range octets:** the subnet is accepted.
- **`:` in the data path:** the path is accepted.
- **`4.0 latest` as a version:** it is accepted.
- **The YAML syntax error:** its message contains `fake-leaked-value`.
- **The alias bomb:** it throws instead of returning a diagnostic.
- **"names the file…" and "says what to check…":** the error message is Node's own,
  such as `EISDIR: illegal operation on a directory…`.

- [ ] **Step 3: Write the implementation**

In `packages/engine/src/config/schema.ts`, replace the `IPV4_CIDR` line with:

```ts
const IPV4_CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(?:\d|[12]\d|3[0-2])$/;
/** A Docker image tag: letters, digits, "_", "." and "-", not starting with "." or "-". */
const DOCKER_TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

function isIpv4Cidr(value: string): boolean {
  const match = IPV4_CIDR.exec(value);
  return match !== null && match.slice(1, 5).every((octet) => Number(octet) <= 255);
}
```

Then make three changes in the same file:

- In `appSettingsSchema`, replace the `version` line with:

  ```ts
  version: z.string().regex(DOCKER_TAG, 'must be a Docker image tag such as 4.0.20').optional(),
  ```

- In `stackShape.paths`, replace the `data` schema with:

  ```ts
      data: z
        .string()
        .regex(/^\//, 'must be an absolute path (start with /)')
        .refine(
          (path) => !path.includes(':'),
          'must not contain ":", which Docker uses to separate volume paths',
        ),
  ```

- In `stackShape.network`, replace the `lan_subnet` schema with:

  ```ts
        lan_subnet: z
          .string()
          .refine(isIpv4Cidr, 'must be an IPv4 CIDR such as 192.168.1.0/24')
          .optional(),
  ```

In `packages/engine/src/config/load.ts`, replace the body of `parseConfig` and add the
helper below it:

```ts
export function parseConfig(source: string): LoadResult {
  const doc = parseDocument(source, { prettyErrors: true });
  if (doc.errors.length > 0) {
    return {
      ok: false,
      diagnostics: doc.errors.map((e) =>
        error('config.yaml-syntax', withoutSource(e.message)),
      ),
    };
  }
  let data: unknown;
  try {
    data = doc.toJS() as unknown;
  } catch (cause) {
    // e.g. "Excessive alias count indicates a resource exhaustion attack"
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, diagnostics: [error('config.yaml-syntax', message)] };
  }
  const result = stackConfigSchema.safeParse(data);
  if (result.success) return { ok: true, config: result.data };
  return { ok: false, diagnostics: result.error.issues.flatMap(toDiagnostics) };
}

/** yaml's pretty errors append the offending source line, which may hold a secret. */
function withoutSource(message: string): string {
  return (message.split('\n')[0] ?? message).replace(/:$/, '');
}
```

Replace `packages/engine/src/util/fs.ts` with:

```ts
import { readFile } from 'node:fs/promises';

/**
 * The file's contents, or undefined if it does not exist. Any other failure is thrown
 * as an error that names the file, and for permission errors, what to check.
 */
export async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (cause) {
    const code =
      cause instanceof Error && 'code' in cause ? String(cause.code) : undefined;
    if (code === 'ENOENT') return undefined;
    const reason = code === undefined ? '' : ` (${code})`;
    const next =
      code === 'EACCES' || code === 'EPERM'
        ? ': check that the user running Mediaplane can read it'
        : '';
    throw new Error(`cannot read ${path}${reason}${next}`, { cause });
  }
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/config packages/engine/src/util packages/cli`

Expected: PASS. That includes the existing "reports YAML syntax errors with their
position" test, which still contains `line N`, and the CLI test
"reports unexpected I/O errors…", whose output still contains `EISDIR`.

- [ ] **Step 5: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "fix(engine): harden config parsing and name files in I/O errors"
```

---

### Task 2: Cloud detection and a wider interface deny-list

**Files:**
- Modify: `packages/engine/src/host/facts.ts`
- Test: `packages/engine/src/host/facts.test.ts`

**Interfaces:**
- **Consumes:** `networkOf` and `privateAddresses` (already in `facts.ts`).
- **Produces:**
  - `HostFacts` gains an optional field, `cloud?: string`, for example
    `"Oracle Cloud"`. It is optional, so existing fixtures stay valid.
  - `type DmiInfo = Partial<Record<'sys_vendor' | 'product_name' | 'product_version' | 'bios_vendor' | 'chassis_asset_tag', string>>`
  - `detectCloud(dmi: DmiInfo): string | undefined`
  - `readDmi(dir = '/sys/class/dmi/id'): DmiInfo`
  - `inSubnet(address: string, cidr: string): boolean`
  - `detectHostFacts(dmiDir?: string): HostFacts`, which now fills in `cloud`.

The cloud signatures follow cloud-init's `ds-identify`. The Oracle signature has been
verified on this machine: `chassis_asset_tag=OracleCloud.com`, with
`sys_vendor=QEMU` and `product_name=KVM Virtual Machine`.

Detection reads DMI only. The roadmap also suggests a metadata-endpoint probe, but it
is deliberately left out: it would add a network call and a timeout to every `plan`,
and DMI already identifies every cloud listed here. A VPS whose firmware isn't
recognised is still protected by `bind: localhost` and by the README's advice.

- [ ] **Step 1: Write the failing tests**

Add the new imports to the existing ones at the top of
`packages/engine/src/host/facts.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

and change the `./facts` import to:

```ts
import {
  detectCloud,
  detectHostFacts,
  inSubnet,
  isPrivateIPv4,
  networkOf,
  privateAddresses,
  readDmi,
  toArch,
} from './facts';
```

Add this test inside `describe('privateAddresses', …)`:

```ts
  it('skips VM, VPN and container-network interfaces', () => {
    expect(
      privateAddresses({
        vboxnet0: [nic('192.168.56.1', '192.168.56.1/24')],
        vmnet8: [nic('172.16.94.1', '172.16.94.1/24')],
        zt5u4b3c2d: [nic('10.147.20.5', '10.147.20.5/24')],
        cali1234abcd: [nic('10.244.0.1', '10.244.0.1/32')],
        tap0: [nic('10.10.10.1', '10.10.10.1/24')],
        nordlynx: [nic('10.5.0.2', '10.5.0.2/16')],
      }),
    ).toEqual([]);
  });
```

Append these blocks to the file:

```ts
describe('detectCloud', () => {
  it.each([
    [{ sys_vendor: 'QEMU', product_name: 'KVM Virtual Machine', chassis_asset_tag: 'OracleCloud.com' }, 'Oracle Cloud'],
    [{ sys_vendor: 'Amazon EC2', product_name: 't3.micro' }, 'Amazon Web Services'],
    [{ sys_vendor: 'Xen', product_version: '4.11.amazon' }, 'Amazon Web Services'],
    [{ sys_vendor: 'Google', product_name: 'Google Compute Engine' }, 'Google Cloud'],
    [
      {
        sys_vendor: 'Microsoft Corporation',
        product_name: 'Virtual Machine',
        chassis_asset_tag: '7783-7084-3265-9085-8269-3286-77',
      },
      'Microsoft Azure',
    ],
    [{ sys_vendor: 'Hetzner', product_name: 'vServer' }, 'Hetzner Cloud'],
    [{ sys_vendor: 'DigitalOcean', product_name: 'Droplet' }, 'DigitalOcean'],
  ])('%o is %s', (dmi, name) => {
    expect(detectCloud(dmi)).toBe(name);
  });

  it.each([
    [{}],
    [{ sys_vendor: 'QEMU', product_name: 'Standard PC (Q35 + ICH9, 2009)' }],
    [{ sys_vendor: 'Microsoft Corporation', product_name: 'Virtual Machine', chassis_asset_tag: '0000-0000-0000' }],
    [{ sys_vendor: 'Dell Inc.', product_name: 'OptiPlex 7070' }],
  ])('%o is not a cloud', (dmi) => {
    expect(detectCloud(dmi)).toBeUndefined();
  });
});

describe('readDmi', () => {
  it('reads the identifying fields and skips missing or empty ones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-dmi-'));
    await writeFile(join(dir, 'sys_vendor'), 'QEMU\n');
    await writeFile(join(dir, 'chassis_asset_tag'), 'OracleCloud.com\n');
    await writeFile(join(dir, 'product_name'), '\n');
    expect(readDmi(dir)).toEqual({ sys_vendor: 'QEMU', chassis_asset_tag: 'OracleCloud.com' });
  });

  it('returns nothing for a directory that does not exist', () => {
    expect(readDmi('/nonexistent/mediaplane/dmi')).toEqual({});
  });
});

describe('inSubnet', () => {
  it.each([
    ['192.168.1.10', '192.168.1.0/24', true],
    ['192.168.2.10', '192.168.1.0/24', false],
    ['10.0.0.208', '10.0.0.0/8', true],
    ['10.0.0.208', '10.0.0.0/32', false],
  ])('%s in %s is %s', (address, cidr, expected) => {
    expect(inSubnet(address, cidr)).toBe(expected);
  });
});

describe('detectHostFacts', () => {
  it('reports the cloud named by the firmware', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-dmi-'));
    await writeFile(join(dir, 'chassis_asset_tag'), 'OracleCloud.com\n');
    expect(detectHostFacts(dir).cloud).toBe('Oracle Cloud');
  });

  it('reports no cloud when the firmware is not a known cloud', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-dmi-'));
    await writeFile(join(dir, 'sys_vendor'), 'QEMU\n');
    expect(detectHostFacts(dir)).not.toHaveProperty('cloud');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/host`

Expected: FAIL. `detectCloud`, `readDmi` and `inSubnet` are not exported, and the
deny-list test returns the six addresses.

- [ ] **Step 3: Write the implementation**

In `packages/engine/src/host/facts.ts`:

1. Change the first import line to

   ```ts
   import { readFileSync } from 'node:fs';
   import { arch, networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
   import { join } from 'node:path';
   ```

2. Add `cloud` to `HostFacts`:

   ```ts
   export interface HostFacts {
     arch: Arch;
     /** Private (RFC 1918) IPv4 addresses on physical interfaces, sorted. */
     privateAddresses: { address: string; cidr: string }[];
     /** The public cloud this VM runs on, when its firmware says so (e.g. "Oracle Cloud"). */
     cloud?: string;
   }
   ```

3. Replace `VIRTUAL_INTERFACE_PREFIXES` with:

   ```ts
   /** Interfaces created by container, VM and VPN software. Never "the LAN". */
   const VIRTUAL_INTERFACE_PREFIXES = [
     'docker', 'br-', 'veth', 'virbr', 'cni', 'flannel', 'podman', 'lxc', 'lxd',
     'tailscale', 'wg', 'tun', 'tap', 'vmnet', 'vboxnet', 'zt', 'ppp', 'nordlynx',
     'cali', 'kube-', 'weave', 'cilium', 'utun', 'vxlan',
   ];
   ```

4. Add, after `networkOf`:

   ```ts
   /** Whether `address` lies inside `cidr`. */
   export function inSubnet(address: string, cidr: string): boolean {
     const prefix = cidr.split('/')[1] ?? '32';
     return networkOf(`${address}/${prefix}`) === networkOf(cidr);
   }

   export type DmiField =
     | 'sys_vendor'
     | 'product_name'
     | 'product_version'
     | 'bios_vendor'
     | 'chassis_asset_tag';
   export type DmiInfo = Partial<Record<DmiField, string>>;

   const DMI_FIELDS: readonly DmiField[] = [
     'sys_vendor',
     'product_name',
     'product_version',
     'bios_vendor',
     'chassis_asset_tag',
   ];

   /** Firmware strings public clouds put in their VMs (the ones cloud-init's ds-identify uses). */
   const CLOUD_SIGNATURES: readonly { name: string; matches: (dmi: DmiInfo) => boolean }[] = [
     {
       name: 'Amazon Web Services',
       matches: (d) =>
         d.sys_vendor === 'Amazon EC2' ||
         d.bios_vendor === 'Amazon EC2' ||
         /amazon/i.test(d.product_version ?? ''),
     },
     { name: 'Microsoft Azure', matches: (d) => d.chassis_asset_tag === '7783-7084-3265-9085-8269-3286-77' },
     { name: 'Google Cloud', matches: (d) => d.product_name === 'Google Compute Engine' || d.sys_vendor === 'Google' },
     { name: 'Oracle Cloud', matches: (d) => d.chassis_asset_tag === 'OracleCloud.com' },
     { name: 'Alibaba Cloud', matches: (d) => d.product_name === 'Alibaba Cloud ECS' },
     { name: 'DigitalOcean', matches: (d) => d.sys_vendor === 'DigitalOcean' },
     { name: 'Hetzner Cloud', matches: (d) => d.sys_vendor === 'Hetzner' },
     { name: 'Scaleway', matches: (d) => d.sys_vendor === 'Scaleway' },
     { name: 'Vultr', matches: (d) => d.sys_vendor === 'Vultr' },
     { name: 'Akamai (Linode)', matches: (d) => d.sys_vendor === 'Linode' || d.sys_vendor === 'Akamai' },
     { name: 'UpCloud', matches: (d) => d.sys_vendor === 'UpCloud' },
     { name: 'Exoscale', matches: (d) => d.product_name === 'Exoscale' },
     { name: 'OpenStack', matches: (d) => /^OpenStack (Nova|Compute)$/.test(d.product_name ?? '') },
   ];

   /** The public cloud these firmware strings belong to, if any. */
   export function detectCloud(dmi: DmiInfo): string | undefined {
     return CLOUD_SIGNATURES.find((signature) => signature.matches(dmi))?.name;
   }

   /** The identifying DMI fields; unreadable or empty ones are left out. */
   export function readDmi(dir = '/sys/class/dmi/id'): DmiInfo {
     const dmi: DmiInfo = {};
     for (const field of DMI_FIELDS) {
       try {
         const value = readFileSync(join(dir, field), 'utf8').trim();
         if (value !== '') dmi[field] = value;
       } catch {
         // Absent or unreadable (not Linux, or a restricted container): unknown.
       }
     }
     return dmi;
   }
   ```

5. Replace `detectHostFacts` with:

   ```ts
   /** Facts about the machine this process runs on. (S2c adds in-container detection.) */
   export function detectHostFacts(dmiDir?: string): HostFacts {
     const hostArch = toArch(arch());
     if (hostArch === undefined) {
       throw new Error(
         `unsupported CPU architecture "${arch()}": Mediaplane supports amd64 and arm64`,
       );
     }
     const cloud = detectCloud(readDmi(dmiDir));
     return {
       arch: hostArch,
       privateAddresses: privateAddresses(networkInterfaces()),
       ...(cloud === undefined ? {} : { cloud }),
     };
   }
   ```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/host && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): detect cloud VMs and skip more virtual interfaces"
```

---

### Task 3: Cloud-safe binding and network-namespace port conflicts

**Files:**
- Modify: `packages/engine/src/resolver/resolve.ts`,
  `packages/engine/src/render/compose.ts`, `packages/engine/src/testing/fixtures.ts`,
  `catalog/gluetun/app.ts`
- Test: `packages/engine/src/resolver/resolve.test.ts`,
  `packages/engine/src/render/compose.test.ts`, `catalog/render.test.ts`

**Interfaces:**
- **Consumes:** `HostFacts.cloud` and `inSubnet` (Task 2).
- **Produces** these resolver diagnostic codes:

  | Code | When | Path | Hint |
  |---|---|---|---|
  | `network.cloud-lan` | `bind: lan` on a host with `cloud`, without `lan_subnet` | `network.bind` | explains `localhost` plus Tailscale, or setting `lan_subnet` explicitly |
  | `port.namespace-conflict` | Two apps in one network namespace listen on the same container port and protocol | `apps.<later app>.port` | `set apps.<id>.port to another port` when that app can move its port |
  | `network.no-lan-address` (existing) | Now also raised when an explicit `lan_subnet` matches none of the host's private addresses | `network.lan_subnet` in that case | — |

- **Binding:** with an explicit `lan_subnet`, `bindAddresses` only includes private
  addresses inside that subnet.
- **Rendering:** the `image` value passes through `literal()`.

Gluetun's HTTP control server listens on port 8000 inside its namespace, and
qBittorrent shares that namespace. A user who set `apps.qbittorrent.port: 8000` would
therefore make qBittorrent fail to start.

- [ ] **Step 1: Write the failing tests**

Add to `packages/engine/src/resolver/resolve.test.ts`. First the new `describe`:

```ts
describe('resolveStack: cloud hosts', () => {
  const lan = BASE.replace('bind: localhost', 'bind: lan');
  const cloudHost: HostFacts = {
    arch: 'amd64',
    privateAddresses: [{ address: '10.0.0.208', cidr: '10.0.0.208/24' }],
    cloud: 'Oracle Cloud',
  };

  it('refuses "lan" on a cloud VM without an explicit subnet', () => {
    const result = resolve('  qbittorrent: {}\n', { base: lan, host: cloudHost });
    expect(result.stack).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'network.cloud-lan', path: 'network.bind' }),
    );
  });

  it('allows "lan" on a cloud VM when the subnet is explicit', () => {
    const base = lan.replace('bind: lan', 'bind: lan, lan_subnet: 10.0.0.0/24');
    expect(resolve('  qbittorrent: {}\n', { base, host: cloudHost }).stack?.bindAddresses).toEqual(
      ['10.0.0.208'],
    );
  });

  it('still allows "localhost" on a cloud VM', () => {
    expect(resolve('  qbittorrent: {}\n', { host: cloudHost }).stack?.bindAddresses).toEqual([
      '127.0.0.1',
    ]);
  });
});
```

Then add inside `describe('resolveStack: binding', …)`:

```ts
  it('only binds to addresses inside an explicit lan_subnet', () => {
    const host: HostFacts = {
      arch: 'amd64',
      privateAddresses: [
        { address: '10.0.0.5', cidr: '10.0.0.5/24' },
        { address: '192.168.1.10', cidr: '192.168.1.10/24' },
      ],
    };
    const base = lan.replace('bind: lan', 'bind: lan, lan_subnet: 192.168.1.0/24');
    expect(resolve('  qbittorrent: {}\n', { base, host }).stack?.bindAddresses).toEqual([
      '192.168.1.10',
    ]);
  });

  it('explains an explicit lan_subnet that matches no address', () => {
    const base = lan.replace('bind: lan', 'bind: lan, lan_subnet: 172.16.0.0/12');
    expect(resolve('  qbittorrent: {}\n', { base }).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'network.no-lan-address', path: 'network.lan_subnet' }),
    );
  });
```

Add inside `describe('resolveStack: ports and images', …)`:

```ts
  it('rejects two apps listening on one port inside a shared network namespace', () => {
    expect(resolve('  qbittorrent: { port: 8000 }\n').diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'port.namespace-conflict',
        path: 'apps.qbittorrent.port',
        hint: 'set apps.qbittorrent.port to another port',
      }),
    );
  });
```

Add inside `describe('renderCompose', …)` in
`packages/engine/src/render/compose.test.ts`:

```ts
  it('escapes dollars in the image reference', () => {
    const stack = stackOf(JELLYFIN_VPN_LAN);
    const sonarr = stack.apps.find((a) => a.def.id === 'sonarr');
    if (sonarr === undefined) throw new Error('sonarr missing');
    sonarr.image = 'registry.test/sonarr:1$x';
    expect(renderCompose(stack).services.sonarr?.image).toBe('registry.test/sonarr:1$$x');
  });
```

Add to `describe('the real catalog', …)` in `catalog/render.test.ts`:

```ts
  it("refuses a qBittorrent port that clashes with Gluetun's control server", () => {
    const source = SPEC_EXAMPLE.replace('  qbittorrent: {}', '  qbittorrent: { port: 8000 }');
    expect(codes(resolve(source).diagnostics)).toContain('port.namespace-conflict');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/resolver packages/engine/src/render catalog`

Expected: the new tests FAIL.

- **The cloud test** finds no `network.cloud-lan` diagnostic.
- **The subnet tests** report both addresses, and give no `network.lan_subnet` path.
- **The namespace tests** report no conflict, because Gluetun declares no port yet.
- **The image test** gets back `1$x`.

The remaining two tests already pass and act as guards: binding to localhost on a
cloud VM, and an explicit subnet on a cloud VM.

- [ ] **Step 3: Write the implementation**

In `packages/engine/src/resolver/resolve.ts`:

1. Change the host import to `import { inSubnet, networkOf, type HostFacts } from '../host/facts';`
2. In `resolveStack`, add `...checkNamespacePorts(apps),` to the `diagnostics.push(…)`
   call, directly after `...checkPortConflicts(apps),`.
3. Add this function after `checkPortConflicts`:

   ```ts
   /**
    * Apps sharing a network namespace (qBittorrent inside Gluetun) listen on the same
    * interfaces, so their container ports must differ, published or not.
    */
   function checkNamespacePorts(apps: readonly ResolvedApp[]): Diagnostic[] {
     const diagnostics: Diagnostic[] = [];
     const listeners = new Map<string, ResolvedApp>();
     for (const app of apps) {
       const namespace = app.networkVia ?? app.def.id;
       for (const spec of app.def.ports) {
         const port = app.containerPorts[spec.name] ?? spec.container;
         const protocol = spec.protocol ?? 'tcp';
         const key = `${namespace}/${protocol}/${port}`;
         const other = listeners.get(key);
         if (other === undefined) {
           listeners.set(key, app);
           continue;
         }
         const movable = app.def.ports.some((p) => p.hostEqualsContainer !== undefined);
         diagnostics.push(
           error(
             'port.namespace-conflict',
             `${other.def.name} and ${app.def.name} both listen on port ${port}/${protocol} inside ${namespace}'s network`,
             {
               path: `apps.${app.def.id}.port`,
               ...withHint(movable ? `set apps.${app.def.id}.port to another port` : undefined),
             },
           ),
         );
       }
     }
     return diagnostics;
   }
   ```

4. Replace the `case 'lan': { … }` block of `bindAddresses` with:

   ```ts
       case 'lan': {
         const subnet = config.network.lan_subnet;
         if (host.cloud !== undefined && subnet === undefined) {
           return {
             addresses: [],
             diagnostics: [
               error(
                 'network.cloud-lan',
                 `network.bind is "lan", but this host looks like a ${host.cloud} VM, where private addresses are often reachable from the internet`,
                 {
                   path: 'network.bind',
                   hint: 'use bind: localhost and reach the stack through Tailscale or an SSH tunnel; if you are sure, set network.lan_subnet to the private network to publish on',
                 },
               ),
             ],
           };
         }
         const addresses = host.privateAddresses
           .filter((a) => subnet === undefined || inSubnet(a.address, subnet))
           .map((a) => a.address)
           .sort(compare);
         if (addresses.length > 0) return { addresses, diagnostics: [] };
         return {
           addresses: [],
           diagnostics: [
             error(
               'network.no-lan-address',
               subnet === undefined
                 ? 'network.bind is "lan", but this host has no private (RFC 1918) IPv4 address'
                 : `network.bind is "lan", but none of this host's private addresses is inside network.lan_subnet ${subnet}`,
               {
                 path: subnet === undefined ? 'network.bind' : 'network.lan_subnet',
                 hint: 'use bind: localhost and reach the stack through Tailscale or an SSH tunnel',
               },
             ),
           ],
         };
       }
   ```

In `packages/engine/src/render/compose.ts`, inside `renderService`, change
`image: app.image,` to `image: literal(app.image),`.

In `catalog/gluetun/app.ts`, change `ports: [],` to:

```ts
  // Gluetun's HTTP control server; apps in its network namespace must not use this port.
  ports: [{ name: 'control', container: 8000, publish: false }],
```

In `packages/engine/src/testing/fixtures.ts`, add the same port to the `gluetun`
fixture app:

```ts
    ports: [{ name: 'control', container: 8000, publish: false }],
```

Unpublished ports are never rendered, so neither golden file changes.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine catalog`

Expected: PASS. Both golden files must match unchanged: `git status --short` must not
list `__golden__/`.

- [ ] **Step 5: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): refuse lan on cloud VMs and catch namespace port clashes"
```

---

### Task 4: Secret references in `apps.<id>.env`

**Files:**
- Modify: `packages/engine/src/config/schema.ts`,
  `packages/engine/src/config/secrets.ts`, `packages/engine/src/render/compose.ts`
- Test: `packages/engine/src/config/load.test.ts`,
  `packages/engine/src/config/secrets.test.ts`,
  `packages/engine/src/render/compose.test.ts`

**Interfaces:**
- **Consumes:** `secretRefSchema` and `SecretRef` (from `config/schema.ts`), and
  `compare`.
- **Produces:**
  - **The `AppSettings.env` type** becomes `Record<string, string | SecretRef>`.
    Invalid values report `env values are strings, or { file: … } / { env: … }
    references for secrets`.
  - **`secretRefs(config)`** additionally returns one `{ path: 'apps.<id>.env.<NAME>',
    ref }` for every reference in an enabled app's env. These come after the existing
    entries, ordered by app id and then variable name.
  - **`appEnvSecretName(appId, name)`** returns, for example, `MP_SONARR_ENV_TOKEN`.
  - **The renderer** emits `${MP_<APP>_ENV_<NAME>}` for a reference value. The value
    itself goes into `.env` in Slice 2b, never into `compose.yaml` (ADR 0009).

- [ ] **Step 1: Write the failing tests**

Add inside `describe('parseConfig', …)` in `packages/engine/src/config/load.test.ts`:

```ts
  it('accepts secret references as env values', () => {
    const result = parseConfig(
      `${MINIMAL}apps:\n  gluetun: { env: { OPENVPN_PASSWORD: { file: secrets/vpn-pass } } }\n`,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.config.apps.gluetun?.env).toEqual({
      OPENVPN_PASSWORD: { file: 'secrets/vpn-pass' },
    });
  });

  it('explains an env value that is neither a string nor a reference', () => {
    const [diagnostic] = diagnosticsOf(`${MINIMAL}apps:\n  sonarr: { env: { X: { nope: 1 } } }\n`);
    expect(diagnostic).toMatchObject({ code: 'config.invalid', path: 'apps.sonarr.env.X' });
    expect(diagnostic?.message).toContain('env values are strings');
  });
```

Add inside `describe('secretRefs and checkSecretRefs', …)` in
`packages/engine/src/config/secrets.test.ts`:

```ts
  it('includes references in enabled apps\' env, ordered by app and name', () => {
    const config = configWith(
      'apps:\n' +
        '  sonarr: { env: { B_TOKEN: { env: FAKE_B }, A_TOKEN: { file: secrets/a }, PLAIN: x } }\n' +
        '  radarr: { enabled: false, env: { C_TOKEN: { env: FAKE_C } } }\n',
    );
    expect(secretRefs(config).map((r) => r.path)).toEqual([
      'apps.sonarr.env.A_TOKEN',
      'apps.sonarr.env.B_TOKEN',
    ]);
  });

  it('reports a missing env reference with its path', async () => {
    const config = configWith('apps:\n  sonarr: { env: { TOKEN: { env: FAKE_MISSING } } }\n');
    expect(await checkSecretRefs(config, await homeWith({}), {})).toEqual([
      expect.objectContaining({ code: 'secret.missing', path: 'apps.sonarr.env.TOKEN' }),
    ]);
  });
```

Change the `./compose` import in `packages/engine/src/render/compose.test.ts` to
`import { appEnvSecretName, literal, renderCompose, secretEnvName } from './compose';`
and add:

```ts
describe('secret env references', () => {
  it('renders a reference as a ${MP_…} variable, never the value or its source', () => {
    const source = JELLYFIN_VPN_LAN.replace(
      'sonarr: { env: { EXTRA: x } }',
      'sonarr: { env: { EXTRA: x, TOKEN: { env: FAKE_TOKEN_SOURCE } } }',
    );
    const compose = renderCompose(stackOf(source));
    expect(compose.services.sonarr?.environment?.TOKEN).toBe('${MP_SONARR_ENV_TOKEN}');
    expect(JSON.stringify(compose)).not.toContain('FAKE_TOKEN_SOURCE');
  });

  it.each([
    ['sonarr', 'TOKEN', 'MP_SONARR_ENV_TOKEN'],
    ['my-app', 'openvpn_password', 'MP_MY_APP_ENV_OPENVPN_PASSWORD'],
  ])('%s/%s → %s', (app, name, expected) => {
    expect(appEnvSecretName(app, name)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/config packages/engine/src/render`

Expected: FAIL. The schema rejects object env values, `secretRefs` doesn't list them,
and `appEnvSecretName` doesn't exist.

- [ ] **Step 3: Write the implementation**

In `packages/engine/src/config/schema.ts`, add a message constant next to the others:

```ts
const ENV_VALUE_MESSAGE =
  'env values are strings, or { file: … } / { env: … } references for secrets';
```

Then replace the `env` line of `appSettingsSchema` with:

```ts
  env: z
    .record(
      z.string().regex(ENV_NAME, ENV_NAME_MESSAGE),
      z.union([z.string(), secretRefSchema], { error: ENV_VALUE_MESSAGE }),
    )
    .default({}),
```

`appSettingsSchema` is declared after `secretRefSchema`, so this reference is valid.

In `packages/engine/src/config/secrets.ts`, add
`import { compare } from '../util/sort';`. Then replace `secretRefs` with:

```ts
/** Every secret reference in stack.yaml, with its dotted path. */
export function secretRefs(config: StackConfig): { path: string; ref: SecretRef }[] {
  const refs: { path: string; ref: SecretRef }[] = [];
  if (config.admin.password)
    refs.push({ path: 'admin.password', ref: config.admin.password });
  // A plex block is dormant unless Plex is the media server.
  if (config.media_server === 'plex' && config.plex)
    refs.push({ path: 'plex.token', ref: config.plex.token });
  if (config.vpn) refs.push({ path: 'vpn.private_key', ref: config.vpn.private_key });
  const apps = Object.entries(config.apps).sort(([a], [b]) => compare(a, b));
  for (const [id, settings] of apps) {
    if (!settings.enabled) continue;
    const env = Object.entries(settings.env).sort(([a], [b]) => compare(a, b));
    for (const [name, value] of env) {
      if (typeof value !== 'string') refs.push({ path: `apps.${id}.env.${name}`, ref: value });
    }
  }
  return refs;
}
```

In `packages/engine/src/render/compose.ts`, add this after `secretEnvName`:

```ts
/** Name of the .env variable carrying a secret from apps.<id>.env, e.g. MP_SONARR_ENV_TOKEN. */
export function appEnvSecretName(appId: string, name: string): string {
  return `MP_${appId}_ENV_${name}`.replace(/-/g, '_').toUpperCase();
}
```

Then, in `renderEnvironment`, replace the line that applies `settings.env` with:

```ts
  for (const [key, value] of Object.entries(settings.env)) {
    env[key] =
      typeof value === 'string' ? literal(value) : `\${${appEnvSecretName(def.id, key)}}`;
  }
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine catalog && pnpm typecheck`

Expected: PASS, and the golden files are unchanged.

- [ ] **Step 5: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): accept secret references in app env and render them as variables"
```

---

### Task 5: The secrets store and secret values (read-only)

**Files:**
- Create: `packages/engine/src/secrets/store.ts`, `packages/engine/src/secrets/values.ts`
- Modify: `packages/engine/src/testing/fixtures.ts`, `packages/engine/src/index.ts`
- Regenerate and review: `packages/engine/src/render/__golden__/jellyfin-vpn-lan.compose.yaml`
- Test: create `packages/engine/src/secrets/store.test.ts` and
  `packages/engine/src/secrets/values.test.ts`; modify
  `packages/engine/src/render/compose.test.ts`

**Interfaces:**
- **Consumes:** `readIfExists` (Task 1), `readSecret`, `secretEnvName` and
  `appEnvSecretName` (Task 4), `ResolvedStack`, and `SecretSource`.
- **Produces:**
  - **The store:**
    - `SECRETS_PATH = 'state/secrets.json'`
    - `type SecretStore = { version: 1; apps: Record<string, Record<string, string>> }`
    - `emptySecretStore(): SecretStore`
    - `readSecretStore(home: string): Promise<SecretStore>`. It throws an error that
      names the file, never its contents, when the file is malformed.
  - **`secretsToGenerate(stack, store): string[]`** returns `"<app>.<secret>"` for each
    `generate` secret missing from the store, in app order and then name order.
  - **`secretValues(stack, store, env): Promise<Record<string, string>>`** returns every
    `${MP_…}` variable that `compose.yaml` references, sorted by key:
    - generated and app-created secrets come from the store;
    - user-provided secrets (`vpn.private_key`, `plex.token`) come from their references;
    - references in `apps.<id>.env` are resolved through `readSecret`;
    - unknown values are `''`.

The fixture `gluetun` gains the same user-provided WireGuard key as the real catalog.
That puts one line into the Jellyfin golden file:
`WIREGUARD_PRIVATE_KEY: "${MP_GLUETUN_WIREGUARD_KEY}"`.

- [ ] **Step 1: Update the fixture**

In `packages/engine/src/testing/fixtures.ts`, give the `gluetun` fixture app these
fields (keep its existing ones):

```ts
    secrets: { wireguardKey: { userProvided: 'vpn.private_key' } },
    credentials: [{ step: 'env', var: 'WIREGUARD_PRIVATE_KEY', secret: 'wireguardKey' }],
```

In `packages/engine/src/render/compose.test.ts`, the test "sets PUID/PGID only for images
that use them" must now expect Gluetun's credential variable. Change its Gluetun
assertion to:

```ts
    expect(compose.services.gluetun?.environment).toEqual({
      TZ: 'Europe/London',
      WIREGUARD_PRIVATE_KEY: '${MP_GLUETUN_WIREGUARD_KEY}',
    });
```

- [ ] **Step 2: Write the failing tests**

`packages/engine/src/secrets/store.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptySecretStore, readSecretStore, SECRETS_PATH } from './store';

async function homeWithStore(content: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-store-'));
  await mkdir(join(home, 'state'));
  await writeFile(join(home, SECRETS_PATH), content);
  return home;
}

describe('readSecretStore', () => {
  it('is empty when the file does not exist', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-store-'));
    expect(await readSecretStore(home)).toEqual(emptySecretStore());
  });

  it('reads a valid store', async () => {
    const store = { version: 1, apps: { sonarr: { apiKey: '0'.repeat(32) } } };
    expect(await readSecretStore(await homeWithStore(JSON.stringify(store)))).toEqual(store);
  });

  it('names the file, not its contents, when it is not JSON', async () => {
    const home = await homeWithStore('{"fake-secret-value"');
    const failure = readSecretStore(home);
    await expect(failure).rejects.toThrow(`${join(home, SECRETS_PATH)} is not valid JSON`);
    await expect(failure).rejects.not.toThrow('fake-secret-value');
  });

  it('rejects a file with the wrong shape', async () => {
    const home = await homeWithStore('{"version": 2, "apps": {}}');
    await expect(readSecretStore(home)).rejects.toThrow('is not a Mediaplane secrets file');
  });
});
```

`packages/engine/src/secrets/values.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { emptySecretStore, type SecretStore } from './store';
import { secretsToGenerate, secretValues } from './values';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  qbittorrent: {}
  sonarr: { env: { TOKEN: { env: FAKE_TOKEN_VAR } } }
`;

async function stackIn(): Promise<ResolvedStack> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-values-'));
  await mkdir(join(home, 'secrets'));
  await writeFile(join(home, 'secrets', 'wg.key'), 'fake-wireguard-key-for-tests\n');
  const result = resolveStack(fixtureConfig(STACK), fixtureCatalog, FIXTURE_HOST, home);
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

const stored: SecretStore = { version: 1, apps: { sonarr: { apiKey: '0'.repeat(32) } } };

describe('secretsToGenerate', () => {
  it('lists generated secrets that are not in the store yet', async () => {
    expect(secretsToGenerate(await stackIn(), emptySecretStore())).toEqual(['sonarr.apiKey']);
  });

  it('is empty once the store has them', async () => {
    expect(secretsToGenerate(await stackIn(), stored)).toEqual([]);
  });
});

describe('secretValues', () => {
  it('collects every referenced variable, with "" for unknown values', async () => {
    expect(await secretValues(await stackIn(), emptySecretStore(), {})).toEqual({
      MP_GLUETUN_WIREGUARD_KEY: 'fake-wireguard-key-for-tests',
      MP_SONARR_API_KEY: '',
      MP_SONARR_ENV_TOKEN: '',
    });
  });

  it('takes generated secrets from the store and env references from the environment', async () => {
    const values = await secretValues(await stackIn(), stored, {
      FAKE_TOKEN_VAR: 'fake-token-value',
    });
    expect(values).toMatchObject({
      MP_SONARR_API_KEY: '0'.repeat(32),
      MP_SONARR_ENV_TOKEN: 'fake-token-value',
    });
    expect(Object.keys(values)).toEqual([...Object.keys(values)].sort());
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/secrets packages/engine/src/render`

Expected: FAIL. `./store` and `./values` cannot be resolved, and the golden
"renders the Jellyfin + VPN + LAN stack" fails on the new `WIREGUARD_PRIVATE_KEY` line.

- [ ] **Step 4: Write the implementation**

`packages/engine/src/secrets/store.ts`:

```ts
import { join } from 'node:path';
import { z } from 'zod';
import { readIfExists } from '../util/fs';

export const SECRETS_PATH = 'state/secrets.json';

const storeSchema = z.strictObject({
  version: z.literal(1),
  apps: z.record(z.string(), z.record(z.string(), z.string())),
});

/** Secrets Mediaplane generated, or apps created, per app: { sonarr: { apiKey: "…" } }. */
export type SecretStore = z.infer<typeof storeSchema>;

export function emptySecretStore(): SecretStore {
  return { version: 1, apps: {} };
}

/** The store, or an empty one if it does not exist yet. Errors never include its contents. */
export async function readSecretStore(home: string): Promise<SecretStore> {
  const path = join(home, SECRETS_PATH);
  const text = await readIfExists(path);
  if (text === undefined) return emptySecretStore();
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
  const parsed = storeSchema.safeParse(data);
  if (!parsed.success) throw new Error(`${path} is not a Mediaplane secrets file`);
  return parsed.data;
}
```

`packages/engine/src/secrets/values.ts`:

```ts
import type { SecretSource } from '../catalog/types';
import type { SecretRef } from '../config/schema';
import { readSecret } from '../config/secrets';
import { appEnvSecretName, secretEnvName } from '../render/compose';
import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';
import { compare } from '../util/sort';
import type { SecretStore } from './store';

/** "<app>.<secret>" for every secret Mediaplane must generate on the next apply. */
export function secretsToGenerate(stack: ResolvedStack, store: SecretStore): string[] {
  const missing: string[] = [];
  for (const app of stack.apps) {
    const secrets = Object.entries(app.def.secrets).sort(([a], [b]) => compare(a, b));
    for (const [name, source] of secrets) {
      if ('generate' in source && store.apps[app.def.id]?.[name] === undefined) {
        missing.push(`${app.def.id}.${name}`);
      }
    }
  }
  return missing;
}

/** The value of every ${MP_…} variable compose.yaml references. Unknown values are "". */
export async function secretValues(
  stack: ResolvedStack,
  store: SecretStore,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const app of stack.apps) {
    for (const step of app.def.credentials) {
      if (step.step !== 'env') continue;
      const source = app.def.secrets[step.secret];
      const value =
        source === undefined
          ? undefined
          : await sourceValue(app, step.secret, source, stack, store, env);
      values[secretEnvName(app.def.id, step.secret)] = value ?? '';
    }
    for (const [name, value] of Object.entries(app.settings.env)) {
      if (typeof value === 'string') continue;
      values[appEnvSecretName(app.def.id, name)] =
        (await readSecret(value, stack.home, env)) ?? '';
    }
  }
  return Object.fromEntries(Object.entries(values).sort(([a], [b]) => compare(a, b)));
}

async function sourceValue(
  app: ResolvedApp,
  name: string,
  source: SecretSource,
  stack: ResolvedStack,
  store: SecretStore,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  if ('userProvided' in source) {
    const ref = userProvidedRef(stack, source.userProvided);
    return ref === undefined ? undefined : readSecret(ref, stack.home, env);
  }
  return store.apps[app.def.id]?.[name];
}

function userProvidedRef(
  stack: ResolvedStack,
  which: 'vpn.private_key' | 'plex.token',
): SecretRef | undefined {
  return which === 'vpn.private_key' ? stack.config.vpn?.private_key : stack.config.plex?.token;
}
```

Append to `packages/engine/src/index.ts`:

```ts
export * from './secrets/store';
export * from './secrets/values';
```

- [ ] **Step 5: Regenerate the Jellyfin golden file and review it**

```bash
rm packages/engine/src/render/__golden__/jellyfin-vpn-lan.compose.yaml
pnpm vitest run packages/engine/src/render
git diff -- packages/engine/src/render/__golden__/
```

Expected: the diff is exactly one added line in the `gluetun` service's
`environment`, `WIREGUARD_PRIVATE_KEY: "${MP_GLUETUN_WIREGUARD_KEY}"`, in sorted key
position (after `TZ`). Any other change means something is wrong, so stop and
investigate. Never hand-edit a golden file.

- [ ] **Step 6: Run them to verify they pass, then run every check and commit**

```bash
pnpm vitest run packages/engine
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): read the secrets store and compute secret values"
```

---

### Task 6: The Docker runtime, and an exact eject command in the header

**Files:**
- Create: `packages/engine/src/runtime/types.ts`, `packages/engine/src/runtime/exec.ts`,
  `packages/engine/src/runtime/docker.ts`
- Modify: `packages/engine/src/render/yaml.ts`, `packages/engine/src/plan/plan.ts`
  (the `composeToYaml` call only), `packages/engine/src/index.ts`
- Regenerate and review: both files in `packages/engine/src/render/__golden__/`
- Test: create `packages/engine/src/runtime/exec.test.ts` and
  `packages/engine/src/runtime/docker.test.ts`; modify
  `packages/engine/src/render/yaml.test.ts`,
  `packages/engine/src/render/compose.test.ts` and `catalog/render.test.ts`

**Interfaces:**
- **Produces, in `runtime/types.ts`:**

  ```ts
  export interface PublishedAddress { address: string; port: number; protocol: 'tcp' | 'udp' }
  export interface ContainerState {
    service: string; id: string;
    state: string;       // "running", "exited", "created", …
    health: string;      // "healthy", "unhealthy", "starting", or "" when there is no check
    configHash: string | undefined;   // com.docker.compose.config-hash
    published: PublishedAddress[];
  }
  export type HashesResult = { ok: true; hashes: Record<string, string> } | { ok: false; error: string };
  export interface Runtime {
    versions(): Promise<{ engine: string; compose: string }>;
    configHashes(compose: string, values: Record<string, string>): Promise<HashesResult>;
    containers(): Promise<ContainerState[]>;
  }
  export class RuntimeError extends Error {}
  ```

- **Produces, in `runtime/exec.ts`:**
  - `type Exec = (command, args, options?: { input?: string; env?: NodeJS.ProcessEnv; cwd?: string }) => Promise<{ code: number; stdout: string; stderr: string }>`
  - `nodeExec`, the real implementation.
- **Produces, in `runtime/docker.ts`:**
  - `OVERRIDE_PATH = 'compose.override.yaml'`
  - `createDockerRuntime({ home, project, exec?, env? }): Runtime`
  - `parseHashes(stdout)` and `parseContainers(stdout)`
- **Produces, in `render/yaml.ts`:**
  - `composeHeader(home): string`
  - `composeToYaml(compose, home)`, which now takes the home as well. `COMPOSE_HEADER`
    is removed.

These are the behaviours the runtime relies on. All were observed with Docker 29.8 and
Compose 5.5.1 on 2026-10-09:

- **`docker compose ps --all --format json`** prints one JSON object per line. The
  `Labels` field is one comma-separated string, and some label values themselves
  contain commas. It works with only `-p`, and prints nothing for an unknown project.
- **`docker compose -p P --project-directory H -f - [-f override] config --hash '*'`**
  takes the compose file on stdin and prints `service hash` lines. It interpolates
  `${VAR}` from the subprocess environment. The hash equals the
  `com.docker.compose.config-hash` label on a container created from the same config.
- **`docker version --format '{{.Server.Version}}'`** fails, with a non-zero exit and a
  message on stderr, when the daemon cannot be reached.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/runtime/exec.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { nodeExec } from './exec';

const node = process.execPath;

describe('nodeExec', () => {
  it('passes input on stdin and captures stdout', async () => {
    const result = await nodeExec(node, ['-e', 'process.stdin.pipe(process.stdout)'], {
      input: 'hello',
    });
    expect(result).toEqual({ code: 0, stdout: 'hello', stderr: '' });
  });

  it('reports the exit code and stderr', async () => {
    const result = await nodeExec(node, ['-e', 'console.error("nope"); process.exit(3)']);
    expect(result).toMatchObject({ code: 3, stderr: 'nope\n' });
  });

  it('passes arguments literally, without a shell', async () => {
    const result = await nodeExec(node, ['-e', 'console.log(process.argv[1])', '$(echo hi)']);
    expect(result.stdout).toBe('$(echo hi)\n');
  });

  it('uses the given environment', async () => {
    const result = await nodeExec(node, ['-e', 'console.log(process.env.FAKE_X)'], {
      env: { FAKE_X: 'fake-value' },
    });
    expect(result.stdout).toBe('fake-value\n');
  });

  it('rejects when the command does not exist', async () => {
    await expect(nodeExec('mediaplane-no-such-command', [])).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
```

`packages/engine/src/runtime/docker.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDockerRuntime, parseContainers, parseHashes } from './docker';
import type { Exec, ExecOptions, ExecResult } from './exec';
import { RuntimeError } from './types';

interface Call {
  args: readonly string[];
  options: ExecOptions | undefined;
}

function recorder(respond: (args: readonly string[]) => ExecResult) {
  const calls: Call[] = [];
  const exec: Exec = (_command, args, options) => {
    calls.push({ args, options });
    return Promise.resolve(respond(args));
  };
  return { exec, calls };
}

const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: '' });
const HASH = 'a'.repeat(64);

const PS_SONARR = JSON.stringify({
  Service: 'sonarr',
  ID: 'd5a2f5c9b82d',
  State: 'running',
  Health: 'healthy',
  Labels: `com.docker.compose.project.config_files=/opt/mediaplane/generated/compose.yaml,/opt/mediaplane/compose.override.yaml,com.docker.compose.config-hash=${HASH},com.docker.compose.service=sonarr`,
  Publishers: [
    { URL: '127.0.0.1', TargetPort: 8989, PublishedPort: 8989, Protocol: 'tcp' },
    { URL: '', TargetPort: 6881, PublishedPort: 0, Protocol: 'tcp' },
  ],
});
const PS_BYPARR = JSON.stringify({
  Service: 'byparr',
  ID: '0b1c2d3e4f5a',
  State: 'exited',
  Health: '',
  Labels: 'com.docker.compose.service=byparr',
  Publishers: [],
});

describe('createDockerRuntime', () => {
  const home = '/opt/mediaplane';

  it('reads the Engine and Compose versions', async () => {
    const { exec } = recorder((args) => (args[0] === 'version' ? ok('29.8.0\n') : ok('v2.30.1\n')));
    expect(await createDockerRuntime({ home, project: 'mediaplane', exec }).versions()).toEqual({
      engine: '29.8.0',
      compose: '2.30.1',
    });
  });

  it('explains a Docker daemon it cannot reach', async () => {
    const { exec } = recorder(() => ({
      code: 1,
      stdout: '',
      stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.\n',
    }));
    const failure = createDockerRuntime({ home, project: 'mediaplane', exec }).versions();
    await expect(failure).rejects.toBeInstanceOf(RuntimeError);
    await expect(failure).rejects.toThrow('cannot talk to Docker: Cannot connect to the Docker daemon');
  });

  it('explains a missing docker command', async () => {
    const exec: Exec = () =>
      Promise.reject(Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }));
    await expect(
      createDockerRuntime({ home, project: 'mediaplane', exec }).versions(),
    ).rejects.toThrow('docker was not found on PATH');
  });

  it('hashes an unwritten compose file from stdin, with secret values in the environment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-runtime-'));
    const { exec, calls } = recorder(() => ok(`sonarr ${HASH}\nradarr ${'b'.repeat(64)}\n`));
    const runtime = createDockerRuntime({ home: dir, project: 'mediaplane', exec, env: {} });
    const result = await runtime.configHashes('name: mediaplane\n', { MP_X: 'fake-x' });
    expect(result).toEqual({ ok: true, hashes: { sonarr: HASH, radarr: 'b'.repeat(64) } });
    expect(calls[0]?.args).toEqual([
      'compose', '-p', 'mediaplane', '--project-directory', dir, '-f', '-', 'config', '--hash', '*',
    ]);
    expect(calls[0]?.options).toMatchObject({ input: 'name: mediaplane\n', cwd: '/', env: { MP_X: 'fake-x' } });
  });

  it("adds the user's compose.override.yaml when it exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-runtime-'));
    await writeFile(join(dir, 'compose.override.yaml'), 'services: {}\n');
    const { exec, calls } = recorder(() => ok(''));
    await createDockerRuntime({ home: dir, project: 'p', exec }).configHashes('x', {});
    expect(calls[0]?.args).toEqual([
      'compose', '-p', 'p', '--project-directory', dir, '-f', '-',
      '-f', join(dir, 'compose.override.yaml'), 'config', '--hash', '*',
    ]);
  });

  it('returns Compose\'s error when it rejects the configuration', async () => {
    const { exec } = recorder(() => ({ code: 15, stdout: '', stderr: 'yaml: line 3: bad\n' }));
    expect(
      await createDockerRuntime({ home, project: 'p', exec }).configHashes('x', {}),
    ).toEqual({ ok: false, error: 'yaml: line 3: bad' });
  });

  it("lists the project's containers by name only", async () => {
    const { exec, calls } = recorder(() => ok(`${PS_SONARR}\n${PS_BYPARR}\n`));
    const containers = await createDockerRuntime({ home, project: 'p', exec }).containers();
    expect(calls[0]?.args).toEqual(['compose', '-p', 'p', 'ps', '--all', '--format', 'json']);
    expect(containers.map((c) => c.service)).toEqual(['sonarr', 'byparr']);
  });
});

describe('parseHashes', () => {
  it('reads "service hash" lines and ignores blanks', () => {
    expect(parseHashes(`sonarr ${HASH}\n\n`)).toEqual({ sonarr: HASH });
  });
});

describe('parseContainers', () => {
  it('reads state, health, config hash and published ports', () => {
    expect(parseContainers(`${PS_SONARR}\n`)).toEqual([
      {
        service: 'sonarr',
        id: 'd5a2f5c9b82d',
        state: 'running',
        health: 'healthy',
        configHash: HASH,
        published: [{ address: '127.0.0.1', port: 8989, protocol: 'tcp' }],
      },
    ]);
  });

  it('has no config hash when the label is absent', () => {
    expect(parseContainers(PS_BYPARR)[0]?.configHash).toBeUndefined();
  });

  it('is empty for no output', () => {
    expect(parseContainers('')).toEqual([]);
  });
});
```

In `packages/engine/src/render/yaml.test.ts`, pass `'/opt/mediaplane'` as the second
argument to both `composeToYaml` calls: `const yaml = composeToYaml(compose);` and
`const trickyYaml = composeToYaml(tricky);`. The existing
`yaml.startsWith('# Generated by Mediaplane — DO NOT EDIT.')` assertion stays as it is.
Add this test inside `describe('composeToYaml', …)`:

```ts
  it('says how to run the stack without Mediaplane', () => {
    expect(yaml).toContain('# Put your own changes in /opt/mediaplane/compose.override.yaml.');
    expect(yaml).toContain('#   docker compose -p mediaplane --project-directory /opt/mediaplane \\');
    expect(yaml).toContain('#     --env-file /opt/mediaplane/generated/.env up -d');
  });
```

In `packages/engine/src/render/compose.test.ts`, change every
`composeToYaml(renderCompose(…))` call to pass `'/opt/mediaplane'` as the second
argument. There are three calls in `describe('golden files', …)`.

In `catalog/render.test.ts`, change `composeToYaml(render(SPEC_EXAMPLE).compose)` to
`composeToYaml(render(SPEC_EXAMPLE).compose, '/opt/mediaplane')`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/runtime packages/engine/src/render catalog`

Expected: FAIL. The runtime modules cannot be resolved, the header test fails, and
`tsc` would also reject the extra argument. The golden files now differ in the header.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/runtime/types.ts`:

```ts
export interface PublishedAddress {
  address: string;
  port: number;
  protocol: 'tcp' | 'udp';
}

/** One container of the Compose project, as `docker compose ps` reports it. */
export interface ContainerState {
  service: string;
  id: string;
  /** "running", "exited", "created", … */
  state: string;
  /** "healthy", "unhealthy", "starting", or "" when the service has no health check. */
  health: string;
  /** Compose's com.docker.compose.config-hash label: equal hashes mean no recreate. */
  configHash: string | undefined;
  published: PublishedAddress[];
}

export type HashesResult =
  | { ok: true; hashes: Record<string, string> }
  | { ok: false; error: string };

/** Everything Mediaplane asks of Docker. One implementation drives the docker CLI. */
export interface Runtime {
  /** Docker Engine and Compose versions; throws RuntimeError when Docker can't be reached. */
  versions(): Promise<{ engine: string; compose: string }>;
  /** Compose's per-service config hashes for an unwritten compose.yaml (+ the user's override). */
  configHashes(compose: string, values: Record<string, string>): Promise<HashesResult>;
  /** Every container in the project, running or not. */
  containers(): Promise<ContainerState[]>;
}

/** Docker is missing or unreachable; the message says which, in words for the user. */
export class RuntimeError extends Error {
  override readonly name = 'RuntimeError';
}
```

`packages/engine/src/runtime/exec.ts`:

```ts
import { spawn } from 'node:child_process';

export interface ExecOptions {
  input?: string | undefined;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
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
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.on('error', () => {
      // The command exited before reading its input; its exit code tells the story.
    });
    child.stdin.end(options.input ?? '');
  });
```

`packages/engine/src/runtime/docker.ts`:

```ts
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { nodeExec, type Exec, type ExecResult } from './exec';
import {
  RuntimeError,
  type ContainerState,
  type HashesResult,
  type Runtime,
} from './types';

export const OVERRIDE_PATH = 'compose.override.yaml';

export interface DockerRuntimeOptions {
  /** Absolute Mediaplane home: the Compose project directory. */
  home: string;
  project: string;
  exec?: Exec;
  env?: NodeJS.ProcessEnv;
}

export function createDockerRuntime(options: DockerRuntimeOptions): Runtime {
  const exec = options.exec ?? nodeExec;
  const baseEnv = options.env ?? process.env;

  async function docker(
    args: readonly string[],
    extra: { input?: string; env?: Record<string, string> } = {},
  ): Promise<ExecResult> {
    try {
      return await exec('docker', args, {
        input: extra.input,
        env: { ...baseEnv, ...extra.env },
        cwd: '/',
      });
    } catch (cause) {
      throw new RuntimeError(
        isNotFound(cause)
          ? 'docker was not found on PATH'
          : `could not run docker: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
  }

  return {
    async versions() {
      const engine = await docker(['version', '--format', '{{.Server.Version}}']);
      if (engine.code !== 0) {
        throw new RuntimeError(`cannot talk to Docker: ${firstLine(engine.stderr)}`);
      }
      const compose = await docker(['compose', 'version', '--short']);
      if (compose.code !== 0) {
        throw new RuntimeError(`Docker Compose is not available: ${firstLine(compose.stderr)}`);
      }
      return { engine: engine.stdout.trim(), compose: compose.stdout.trim().replace(/^v/, '') };
    },

    async configHashes(compose, values): Promise<HashesResult> {
      const override = join(options.home, OVERRIDE_PATH);
      const overrideArgs = (await exists(override)) ? ['-f', override] : [];
      const result = await docker(
        [
          'compose', '-p', options.project, '--project-directory', options.home,
          '-f', '-', ...overrideArgs, 'config', '--hash', '*',
        ],
        { input: compose, env: values },
      );
      if (result.code !== 0) return { ok: false, error: result.stderr.trim() };
      return { ok: true, hashes: parseHashes(result.stdout) };
    },

    async containers() {
      const result = await docker([
        'compose', '-p', options.project, 'ps', '--all', '--format', 'json',
      ]);
      if (result.code !== 0) {
        throw new RuntimeError(`docker compose ps failed: ${firstLine(result.stderr)}`);
      }
      return parseContainers(result.stdout);
    },
  };
}

/** `docker compose config --hash` output: one "service hash" pair per line. */
export function parseHashes(stdout: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const [service, hash] = line.trim().split(/\s+/);
    if (service !== undefined && service !== '' && hash !== undefined) hashes[service] = hash;
  }
  return hashes;
}

interface PsLine {
  Service?: unknown;
  ID?: unknown;
  State?: unknown;
  Health?: unknown;
  Labels?: unknown;
  Publishers?: unknown;
}

interface PsPublisher {
  URL?: unknown;
  PublishedPort?: unknown;
  Protocol?: unknown;
}

/** `docker compose ps --format json` output: one JSON object per line. */
export function parseContainers(stdout: string): ContainerState[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const raw = JSON.parse(line) as PsLine;
      // Labels is one "k=v,k=v" string whose values may contain commas: match, don't split.
      const labels = text(raw.Labels);
      const publishers = Array.isArray(raw.Publishers) ? (raw.Publishers as PsPublisher[]) : [];
      return {
        service: text(raw.Service),
        id: text(raw.ID),
        state: text(raw.State),
        health: text(raw.Health),
        configHash: /com\.docker\.compose\.config-hash=([0-9a-f]{64})/.exec(labels)?.[1],
        published: publishers.flatMap((p) =>
          typeof p.PublishedPort === 'number' && p.PublishedPort > 0
            ? [
                {
                  address: text(p.URL),
                  port: p.PublishedPort,
                  protocol: p.Protocol === 'udp' ? ('udp' as const) : ('tcp' as const),
                },
              ]
            : [],
        ),
      };
    });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function firstLine(value: string): string {
  return value.trim().split('\n')[0] ?? '';
}

function isNotFound(cause: unknown): boolean {
  return cause instanceof Error && 'code' in cause && cause.code === 'ENOENT';
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
```

Replace `packages/engine/src/render/yaml.ts` with:

```ts
import { Document, isMap, isScalar, isSeq, Scalar, visit } from 'yaml';
import { PROJECT_NAME, type ComposeFile } from './compose';

/** The do-not-edit header, with the exact command to run the stack without Mediaplane. */
export function composeHeader(home: string): string {
  // Each line starts with a space so it renders as "# …".
  return [
    ' Generated by Mediaplane — DO NOT EDIT. This file is rewritten on every apply.',
    ` Put your own changes in ${home}/compose.override.yaml.`,
    ' To run this stack without Mediaplane:',
    `   docker compose -p ${PROJECT_NAME} --project-directory ${home} \\`,
    `     -f ${home}/generated/compose.yaml -f ${home}/compose.override.yaml \\`,
    `     --env-file ${home}/generated/.env up -d`,
    ' (leave out the compose.override.yaml file if you have not created one).',
  ].join('\n');
}

export function composeToYaml(compose: ComposeFile, home: string): string {
  const doc = new Document(compose);
  // Compose's YAML parser resolves more plain scalars than YAML 1.2 does: "80:80" is read
  // as a base-60 number, and "1_000", "0b101" and "2024-01-01" as a number or a timestamp.
  // Values are strings, so quote every one that could be user-supplied.
  visit(doc, {
    Pair(_key, pair) {
      if (!isScalar(pair.key)) return;
      if (pair.key.value === 'ports' && isSeq(pair.value)) {
        for (const item of pair.value.items) {
          if (isScalar(item)) item.type = Scalar.QUOTE_DOUBLE;
        }
      }
      if (pair.key.value === 'user' && isScalar(pair.value)) {
        pair.value.type = Scalar.QUOTE_DOUBLE;
      }
      if (
        (pair.key.value === 'environment' || pair.key.value === 'labels') &&
        isMap(pair.value)
      ) {
        for (const entry of pair.value.items) {
          if (isScalar(entry.value)) entry.value.type = Scalar.QUOTE_DOUBLE;
        }
      }
    },
  });
  doc.commentBefore = composeHeader(home);
  return doc.toString({ lineWidth: 0 });
}
```

In `packages/engine/src/plan/plan.ts`, change
`const compose = composeToYaml(renderCompose(resolved.stack));` to
`const compose = composeToYaml(renderCompose(resolved.stack), home);`.

Append to `packages/engine/src/index.ts`:

```ts
export * from './runtime/types';
export * from './runtime/exec';
export * from './runtime/docker';
```

- [ ] **Step 4: Regenerate both golden files and review them**

```bash
rm packages/engine/src/render/__golden__/*.compose.yaml
pnpm vitest run packages/engine/src/render
git diff -- packages/engine/src/render/__golden__/
```

Expected: in both files the only change is the header. The two old comment lines are
replaced by these seven, with nothing else in either file changed:

```yaml
# Generated by Mediaplane — DO NOT EDIT. This file is rewritten on every apply.
# Put your own changes in /opt/mediaplane/compose.override.yaml.
# To run this stack without Mediaplane:
#   docker compose -p mediaplane --project-directory /opt/mediaplane \
#     -f /opt/mediaplane/generated/compose.yaml -f /opt/mediaplane/compose.override.yaml \
#     --env-file /opt/mediaplane/generated/.env up -d
# (leave out the compose.override.yaml file if you have not created one).
```

- [ ] **Step 5: Run them to verify they pass, then run every check and commit**

```bash
pnpm vitest run packages/engine catalog
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): add the Docker runtime and an exact eject command"
```

---

### Task 7: Preflight checks

**Files:**
- Create: `packages/engine/src/preflight/probe.ts`, `packages/engine/src/preflight/checks.ts`
- Modify: `packages/engine/src/index.ts`
- Test: create `packages/engine/src/preflight/probe.test.ts` and
  `packages/engine/src/preflight/checks.test.ts`

**Interfaces:**
- **Consumes:**
  - `ResolvedStack`, including each app's `ports`, `context` and `def.extras`;
  - `error`, `warning` and `withHint`;
  - `unique`.
- **Produces, in `preflight/probe.ts`:**
  - `interface PathStat { isDirectory: boolean; isCharacterDevice: boolean; uid: number; gid: number; mode: number; dev: number }`
  - `interface HostProbe { stat(path); freeBytes(path); portFree(address, port, protocol) }`.
    `portFree` resolves to `true` when free, `false` when in use, and `undefined` when it
    can't tell, for example for an address not on this host.
  - `nodeProbe`, the real implementation.
- **Produces, in `preflight/checks.ts`:**
  - `MIN_DOCKER_ENGINE = '24.0.0'`, `MIN_DOCKER_COMPOSE = '2.24.0'`
  - `interface PreflightInput { stack; versions: { engine; compose }; ownPorts: ReadonlySet<string> }`
  - `portKey(protocol, address, port): string`, for example `"tcp/127.0.0.1:8989"`
  - `versionAtLeast(actual, minimum): boolean`
  - `writableBy(stat, uid, gid): boolean`
  - `runPreflight(input, probe): Promise<Diagnostic[]>`

The diagnostic codes are part of the contract:

| Code | Severity | Path | When |
|---|---|---|---|
| `preflight.docker-version` | error | — | Docker Engine is older than 24.0.0 |
| `preflight.compose-version` | error | — | Compose is older than 2.24.0 |
| `preflight.disk-full` | error | — | Less than 2 GiB free at the home or data folder |
| `preflight.disk-low` | warning | — | Less than 10 GiB free there |
| `preflight.data-missing` | error | `paths.data` | The data folder doesn't exist. The hint gives the `mkdir`/`chown` commands |
| `preflight.data-not-directory` | error | `paths.data` | The data path isn't a directory |
| `preflight.data-not-writable` | error | `paths.data` | Not writable by the stack's uid/gid |
| `preflight.cross-filesystem` | error | `paths.data` | An existing `torrents`, `usenet` or `media` subfolder is on a different filesystem from the data folder |
| `preflight.device-missing` | error | `apps.<id>` | A device an app's `extras` needs is not a character device. For `/dev/net/tun` the hint is `sudo modprobe tun` |
| `preflight.port-in-use` | error | `apps.<id>.port` | A published `address:port` is taken by something other than this project's own containers |

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/preflight/probe.test.ts`:

```ts
import { createSocket } from 'node:dgram';
import { mkdtemp } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeProbe } from './probe';

describe('nodeProbe.stat', () => {
  it('describes a directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-probe-'));
    expect(await nodeProbe.stat(dir)).toMatchObject({ isDirectory: true, isCharacterDevice: false });
  });

  it('recognises a character device', async () => {
    expect(await nodeProbe.stat('/dev/null')).toMatchObject({ isCharacterDevice: true });
  });

  it('is undefined for a missing path', async () => {
    expect(await nodeProbe.stat('/nonexistent/mediaplane')).toBeUndefined();
  });
});

describe('nodeProbe.freeBytes', () => {
  it('reports free space, or undefined for a missing path', async () => {
    expect(await nodeProbe.freeBytes(tmpdir())).toBeGreaterThan(0);
    expect(await nodeProbe.freeBytes('/nonexistent/mediaplane')).toBeUndefined();
  });
});

describe('nodeProbe.portFree', () => {
  it('sees a TCP port another listener holds, and sees it free again after', async () => {
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    expect(await nodeProbe.portFree('127.0.0.1', port, 'tcp')).toBe(false);
    await new Promise<void>((done) => server.close(() => done()));
    expect(await nodeProbe.portFree('127.0.0.1', port, 'tcp')).toBe(true);
  });

  it('sees a UDP port another socket holds', async () => {
    const socket = createSocket('udp4');
    await new Promise<void>((done) => socket.bind(0, '127.0.0.1', done));
    const { port } = socket.address();
    expect(await nodeProbe.portFree('127.0.0.1', port, 'udp')).toBe(false);
    await new Promise<void>((done) => socket.close(() => done()));
  });

  it("can't tell for an address that is not on this host", async () => {
    expect(await nodeProbe.portFree('203.0.113.77', 8989, 'tcp')).toBeUndefined();
  });
});
```

`packages/engine/src/preflight/checks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Catalog } from '../catalog/types';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { fakeProbe } from '../testing/fakes';
import { FIXTURE_HOST, fixtureApp, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { portKey, runPreflight, versionAtLeast, writableBy, type PreflightInput } from './checks';
import type { PathStat } from './probe';

const GIB = 1024 ** 3;
const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  qbittorrent: { vpn: false }
  sonarr: {}
`;

function stackOf(source = STACK, catalog: Catalog = fixtureCatalog): ResolvedStack {
  const result = resolveStack(fixtureConfig(source), catalog, FIXTURE_HOST, '/opt/mediaplane');
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

function input(overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    stack: stackOf(),
    versions: { engine: '29.8.0', compose: '5.5.1' },
    ownPorts: new Set(),
    ...overrides,
  };
}

const dir = (extra: Partial<PathStat> = {}): PathStat => ({
  isDirectory: true,
  isCharacterDevice: false,
  uid: 1000,
  gid: 1000,
  mode: 0o40755,
  dev: 1,
  ...extra,
});

const codes = (diagnostics: { code: string }[]) => diagnostics.map((d) => d.code);

describe('runPreflight', () => {
  it('is quiet on a healthy host', async () => {
    expect(await runPreflight(input(), fakeProbe())).toEqual([]);
  });

  it('requires recent Docker and Compose', async () => {
    const old = input({ versions: { engine: '20.10.24', compose: '2.20.0' } });
    expect(codes(await runPreflight(old, fakeProbe()))).toEqual([
      'preflight.docker-version',
      'preflight.compose-version',
    ]);
  });

  it('fails below 2 GiB free and warns below 10 GiB', async () => {
    expect(codes(await runPreflight(input(), fakeProbe({ freeBytes: 1 * GIB })))).toEqual([
      'preflight.disk-full',
      'preflight.disk-full',
    ]);
    const low = await runPreflight(input(), fakeProbe({ freeBytes: 5 * GIB }));
    expect(low).toEqual([
      expect.objectContaining({ code: 'preflight.disk-low', severity: 'warning' }),
      expect.objectContaining({ code: 'preflight.disk-low', severity: 'warning' }),
    ]);
  });

  it('explains a missing data folder with the commands that fix it', async () => {
    const result = await runPreflight(input(), fakeProbe({ stats: { '/srv/data': undefined } }));
    expect(result).toEqual([
      expect.objectContaining({
        code: 'preflight.data-missing',
        path: 'paths.data',
        hint: 'sudo mkdir -p /srv/data && sudo chown 1000:1000 /srv/data',
      }),
    ]);
  });

  it('requires the data folder to be a writable directory', async () => {
    const file = fakeProbe({ stats: { '/srv/data': dir({ isDirectory: false }) } });
    expect(codes(await runPreflight(input(), file))).toEqual(['preflight.data-not-directory']);
    const rootOwned = fakeProbe({ stats: { '/srv/data': dir({ uid: 0, gid: 0 }) } });
    expect(codes(await runPreflight(input(), rootOwned))).toEqual(['preflight.data-not-writable']);
  });

  it('requires downloads and media on one filesystem', async () => {
    const probe = fakeProbe({ stats: { '/srv/data/media': dir({ dev: 2 }) } });
    expect(codes(await runPreflight(input(), probe))).toEqual(['preflight.cross-filesystem']);
  });

  it('checks the devices apps need', async () => {
    const catalog = fixtureCatalog.map((def) =>
      def.id === 'gluetun'
        ? fixtureApp({ ...def, extras: () => ({ devices: ['/dev/net/tun:/dev/net/tun'] }) })
        : def,
    );
    const stack = stackOf(
      STACK.replace('  qbittorrent: { vpn: false }\n', '  qbittorrent: {}\n') +
        'vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }\n',
      catalog,
    );
    const result = await runPreflight(
      input({ stack }),
      fakeProbe({ stats: { '/dev/net/tun': undefined } }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        code: 'preflight.device-missing',
        path: 'apps.gluetun',
        hint: 'load the TUN module: sudo modprobe tun',
      }),
    ]);
  });

  it('reports a published port that something else is using', async () => {
    const probe = fakeProbe({ busyPorts: [portKey('tcp', '127.0.0.1', 8989)] });
    expect(await runPreflight(input(), probe)).toEqual([
      expect.objectContaining({ code: 'preflight.port-in-use', path: 'apps.sonarr.port' }),
    ]);
  });

  it("ignores ports this project's own containers publish", async () => {
    const key = portKey('tcp', '127.0.0.1', 8989);
    const probe = fakeProbe({ busyPorts: [key] });
    expect(await runPreflight(input({ ownPorts: new Set([key]) }), probe)).toEqual([]);
  });
});

describe('versionAtLeast', () => {
  it.each([
    ['24.0.0', '24.0.0', true],
    ['29.8.0', '24.0.0', true],
    ['v2.30.1', '2.24.0', true],
    ['2.23.9', '2.24.0', false],
    ['5.5.1', '2.24.0', true],
    ['2.24.0-desktop.1', '2.24.0', true],
    ['20.10.24', '24.0.0', false],
  ])('%s ≥ %s is %s', (actual, minimum, expected) => {
    expect(versionAtLeast(actual, minimum)).toBe(expected);
  });
});

describe('writableBy', () => {
  it.each([
    [dir({ uid: 1000, mode: 0o40755 }), 1000, 1000, true],
    [dir({ uid: 1000, mode: 0o40555 }), 1000, 1000, false],
    [dir({ uid: 0, gid: 1000, mode: 0o40775 }), 1000, 1000, true],
    [dir({ uid: 0, gid: 0, mode: 0o40755 }), 1000, 1000, false],
    [dir({ uid: 0, gid: 0, mode: 0o40777 }), 1000, 1000, true],
    [dir({ uid: 0, gid: 0, mode: 0o40700 }), 0, 0, true],
  ])('%o for %i:%i is %s', (stat, uid, gid, expected) => {
    expect(writableBy(stat, uid, gid)).toBe(expected);
  });
});
```

Test fakes are needed by this and later tasks. Create
`packages/engine/src/testing/fakes.ts` now. `fakeRuntime`, `running` and `fakeHash`
are used from Task 8:

```ts
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import type { HostProbe, PathStat } from '../preflight/probe';
import {
  RuntimeError,
  type ContainerState,
  type HashesResult,
  type Runtime,
} from '../runtime/types';

/** A probe for a healthy host: every path is a writable directory, every port is free. */
export function fakeProbe(
  options: {
    /** Overrides by path; `undefined` means "does not exist". */
    stats?: Record<string, PathStat | undefined>;
    freeBytes?: number;
    /** portKey()s that are in use. */
    busyPorts?: readonly string[];
  } = {},
): HostProbe {
  const stats = options.stats ?? {};
  const healthyDir: PathStat = {
    isDirectory: true,
    isCharacterDevice: false,
    uid: 1000,
    gid: 1000,
    mode: 0o40755,
    dev: 1,
  };
  return {
    stat: (path) =>
      Promise.resolve(
        Object.hasOwn(stats, path)
          ? stats[path]
          : path.startsWith('/dev/')
            ? { ...healthyDir, isDirectory: false, isCharacterDevice: true, mode: 0o20666 }
            : healthyDir,
      ),
    freeBytes: () => Promise.resolve(options.freeBytes ?? 100 * 1024 ** 3),
    portFree: (address, port, protocol) =>
      Promise.resolve(!(options.busyPorts ?? []).includes(`${protocol}/${address}:${port}`)),
  };
}

/** A stand-in for Compose's config hash: stable per service config and secret values. */
export function fakeHash(compose: string, values: Record<string, string>): Record<string, string> {
  const parsed = parse(compose) as { services?: Record<string, unknown> };
  return Object.fromEntries(
    Object.entries(parsed.services ?? {}).map(([service, config]) => [
      service,
      createHash('sha256').update(JSON.stringify([config, values])).digest('hex'),
    ]),
  );
}

/** A Docker that answers from memory. */
export function fakeRuntime(
  options: {
    versions?: { engine: string; compose: string };
    containers?: ContainerState[];
    hashes?: HashesResult;
    /** When set, Docker is unreachable with this message. */
    unavailable?: string;
  } = {},
): Runtime {
  return {
    versions: () =>
      options.unavailable === undefined
        ? Promise.resolve(options.versions ?? { engine: '29.8.0', compose: '5.5.1' })
        : Promise.reject(new RuntimeError(options.unavailable)),
    configHashes: (compose, values) =>
      Promise.resolve(options.hashes ?? { ok: true, hashes: fakeHash(compose, values) }),
    containers: () => Promise.resolve(options.containers ?? []),
  };
}

/** Running, healthy containers whose config hashes are `hashes`. */
export function running(hashes: Record<string, string>): ContainerState[] {
  return Object.entries(hashes).map(([service, configHash]) => ({
    service,
    id: `fake-${service}`,
    state: 'running',
    health: 'healthy',
    configHash,
    published: [],
  }));
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/preflight`

Expected: FAIL, because `./probe` and `./checks` cannot be resolved. The `fakes.ts` file
also fails to type-check until they exist.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/preflight/probe.ts`:

```ts
import { createSocket } from 'node:dgram';
import { stat, statfs } from 'node:fs/promises';
import { createServer } from 'node:net';

export interface PathStat {
  isDirectory: boolean;
  isCharacterDevice: boolean;
  uid: number;
  gid: number;
  mode: number;
  /** Filesystem (device) id: equal for paths on the same filesystem. */
  dev: number;
}

/** What preflight needs to know about the host. Tests swap in fakeProbe(). */
export interface HostProbe {
  stat(path: string): Promise<PathStat | undefined>;
  freeBytes(path: string): Promise<number | undefined>;
  /** true = free, false = in use, undefined = can't tell (e.g. not an address of this host). */
  portFree(address: string, port: number, protocol: 'tcp' | 'udp'): Promise<boolean | undefined>;
}

export const nodeProbe: HostProbe = {
  async stat(path) {
    try {
      const s = await stat(path);
      return {
        isDirectory: s.isDirectory(),
        isCharacterDevice: s.isCharacterDevice(),
        uid: s.uid,
        gid: s.gid,
        mode: s.mode,
        dev: s.dev,
      };
    } catch {
      return undefined;
    }
  },
  async freeBytes(path) {
    try {
      const s = await statfs(path);
      return s.bavail * s.bsize;
    } catch {
      return undefined;
    }
  },
  portFree(address, port, protocol) {
    return protocol === 'udp' ? udpPortFree(address, port) : tcpPortFree(address, port);
  },
};

function tcpPortFree(address: string, port: number): Promise<boolean | undefined> {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolvePromise(error.code === 'EADDRINUSE' ? false : undefined);
    });
    server.listen({ host: address, port, exclusive: true }, () => {
      server.close(() => {
        resolvePromise(true);
      });
    });
  });
}

function udpPortFree(address: string, port: number): Promise<boolean | undefined> {
  return new Promise((resolvePromise) => {
    const socket = createSocket('udp4');
    socket.once('error', (error: NodeJS.ErrnoException) => {
      socket.close();
      resolvePromise(error.code === 'EADDRINUSE' ? false : undefined);
    });
    socket.bind({ address, port, exclusive: true }, () => {
      socket.close(() => {
        resolvePromise(true);
      });
    });
  });
}
```

`packages/engine/src/preflight/checks.ts`:

```ts
import { error, warning, withHint, type Diagnostic } from '../diagnostics';
import type { ResolvedStack } from '../resolver/resolve';
import { unique } from '../util/sort';
import type { HostProbe, PathStat } from './probe';

export const MIN_DOCKER_ENGINE = '24.0.0';
export const MIN_DOCKER_COMPOSE = '2.24.0';

const GIB = 1024 ** 3;
const DISK_ERROR_BYTES = 2 * GIB;
const DISK_WARNING_BYTES = 10 * GIB;

/** Download and library folders that must share one filesystem, so moves are hardlinks. */
const DATA_SUBDIRS = ['torrents', 'usenet', 'media'] as const;

export interface PreflightInput {
  stack: ResolvedStack;
  versions: { engine: string; compose: string };
  /** portKey()s this project's own containers already publish (re-applies must not trip). */
  ownPorts: ReadonlySet<string>;
}

export function portKey(protocol: 'tcp' | 'udp', address: string, port: number): string {
  return `${protocol}/${address}:${port}`;
}

/** Host checks that fail fast, before anything is touched (spec §5, stage 3). */
export async function runPreflight(
  input: PreflightInput,
  probe: HostProbe,
): Promise<Diagnostic[]> {
  return [
    ...checkVersions(input.versions),
    ...(await checkDisk(input.stack, probe)),
    ...(await checkDataRoot(input.stack, probe)),
    ...(await checkDevices(input.stack, probe)),
    ...(await checkPorts(input, probe)),
  ];
}

/** Compares the first three numeric parts; a leading "v" and suffixes are ignored. */
export function versionAtLeast(actual: string, minimum: string): boolean {
  const parse = (version: string) =>
    version
      .replace(/^v/, '')
      .split(/[.+-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(actual);
  const m = parse(minimum);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = m[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** POSIX write permission for uid/gid: owner bits if owner, else group bits, else other. */
export function writableBy(stat: PathStat, uid: number, gid: number): boolean {
  if (uid === 0) return true;
  if (stat.uid === uid) return (stat.mode & 0o200) !== 0;
  if (stat.gid === gid) return (stat.mode & 0o020) !== 0;
  return (stat.mode & 0o002) !== 0;
}

function checkVersions(versions: { engine: string; compose: string }): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!versionAtLeast(versions.engine, MIN_DOCKER_ENGINE)) {
    diagnostics.push(
      error(
        'preflight.docker-version',
        `Docker Engine ${versions.engine} is too old; Mediaplane needs ${MIN_DOCKER_ENGINE} or newer`,
        { hint: 'upgrade Docker: https://docs.docker.com/engine/install/' },
      ),
    );
  }
  if (!versionAtLeast(versions.compose, MIN_DOCKER_COMPOSE)) {
    diagnostics.push(
      error(
        'preflight.compose-version',
        `Docker Compose ${versions.compose} is too old; Mediaplane needs ${MIN_DOCKER_COMPOSE} or newer`,
        { hint: "install Docker's docker-compose-plugin package" },
      ),
    );
  }
  return diagnostics;
}

async function checkDisk(stack: ResolvedStack, probe: HostProbe): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const path of unique([stack.home, stack.config.paths.data])) {
    const free = await probe.freeBytes(path);
    if (free === undefined) continue;
    const gib = (free / GIB).toFixed(1);
    if (free < DISK_ERROR_BYTES) {
      diagnostics.push(
        error('preflight.disk-full', `only ${gib} GiB free at ${path}; Mediaplane needs at least 2 GiB`, {
          hint: 'free up space before applying',
        }),
      );
    } else if (free < DISK_WARNING_BYTES) {
      diagnostics.push(
        warning('preflight.disk-low', `only ${gib} GiB free at ${path}`, {
          hint: 'images and downloads need room; consider freeing space',
        }),
      );
    }
  }
  return diagnostics;
}

async function checkDataRoot(stack: ResolvedStack, probe: HostProbe): Promise<Diagnostic[]> {
  const data = stack.config.paths.data;
  const { uid, gid } = stack.config.user;
  const root = await probe.stat(data);
  if (root === undefined) {
    return [
      error('preflight.data-missing', `the data folder ${data} does not exist`, {
        path: 'paths.data',
        hint: `sudo mkdir -p ${data} && sudo chown ${uid}:${gid} ${data}`,
      }),
    ];
  }
  if (!root.isDirectory) {
    return [
      error('preflight.data-not-directory', `the data folder ${data} is not a directory`, {
        path: 'paths.data',
      }),
    ];
  }
  const diagnostics: Diagnostic[] = [];
  if (!writableBy(root, uid, gid)) {
    diagnostics.push(
      error(
        'preflight.data-not-writable',
        `the data folder ${data} is not writable by uid ${uid} / gid ${gid}, which the apps run as`,
        { path: 'paths.data', hint: `sudo chown ${uid}:${gid} ${data}` },
      ),
    );
  }
  for (const name of DATA_SUBDIRS) {
    const sub = await probe.stat(`${data}/${name}`);
    if (sub !== undefined && sub.dev !== root.dev) {
      diagnostics.push(
        error(
          'preflight.cross-filesystem',
          `${data}/${name} is on a different filesystem from ${data}, so moves can't be instant hardlinks`,
          {
            path: 'paths.data',
            hint: 'keep downloads and media on one filesystem (one mount) under the data folder',
          },
        ),
      );
    }
  }
  return diagnostics;
}

async function checkDevices(stack: ResolvedStack, probe: HostProbe): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const app of stack.apps) {
    for (const device of app.def.extras?.(app.context).devices ?? []) {
      const hostPath = device.split(':')[0] ?? device;
      const stat = await probe.stat(hostPath);
      if (stat?.isCharacterDevice === true) continue;
      diagnostics.push(
        error(
          'preflight.device-missing',
          `${app.def.name} needs ${hostPath}, which does not exist on this host`,
          {
            path: `apps.${app.def.id}`,
            ...withHint(
              hostPath === '/dev/net/tun' ? 'load the TUN module: sudo modprobe tun' : undefined,
            ),
          },
        ),
      );
    }
  }
  return diagnostics;
}

async function checkPorts(input: PreflightInput, probe: HostProbe): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const app of input.stack.apps) {
    for (const port of app.ports) {
      for (const address of input.stack.bindAddresses) {
        if (input.ownPorts.has(portKey(port.protocol, address, port.host))) continue;
        if ((await probe.portFree(address, port.host, port.protocol)) !== false) continue;
        diagnostics.push(
          error(
            'preflight.port-in-use',
            `${address}:${port.host}/${port.protocol}, which ${app.def.name} needs, is already in use on this host`,
            {
              path: `apps.${app.def.id}.port`,
              hint: `stop whatever is using it, or set apps.${app.def.id}.port to a free port`,
            },
          ),
        );
      }
    }
  }
  return diagnostics;
}
```

Append to `packages/engine/src/index.ts`:

```ts
export * from './preflight/probe';
export * from './preflight/checks';
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/preflight && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): add preflight host checks"
```

---

### Task 8: Container plan, `plan()` against the runtime, and the CLI that shows it

The engine and CLI halves land in one commit. Once `plan()` needs a `Runtime`, the CLI's
unit tests would reach the real Docker until the CLI can inject fakes. Splitting the
work would leave one commit with failing tests.

**Files:**
- Create: `packages/engine/src/plan/containers.ts`,
  `packages/engine/src/testing/index.ts`,
  `docs/adr/0010-predict-container-changes-with-compose-hashes.md`
- Modify: `packages/engine/src/plan/plan.ts`, `packages/engine/package.json` (the
  `./testing` export), `packages/engine/src/index.ts`, `packages/cli/src/run.ts`,
  `packages/cli/src/output.ts`
- Test: create `packages/engine/src/plan/containers.test.ts`; replace
  `packages/engine/src/plan/plan.test.ts` and `packages/cli/src/run.test.ts`; modify
  `packages/cli/src/main.test.ts`

**Interfaces:**
- **Consumes:**
  - from Task 5: `readSecretStore`, `secretsToGenerate` and `secretValues`;
  - from Task 6: the `Runtime` type, `RuntimeError` and `composeToYaml(compose, home)`;
  - from Task 7: the `HostProbe` type, `runPreflight` and `portKey`;
  - the test fakes.
- **Produces:**
  - **Container changes:**
    - `type ContainerAction = 'create' | 'recreate' | 'start' | 'remove' | 'unchanged'`
    - `interface ContainerChange { service: string; action: ContainerAction }`
    - `planContainers(desired: Record<string, string>, current: readonly ContainerState[]): ContainerChange[]`.
      Desired services come first, sorted, then removals, sorted.
    - `ownPorts(containers): Set<string>`
  - **`PlanOptions`** is now
    `{ home; catalog; host; env; runtime: Runtime; probe: HostProbe }`.
  - **`PlanResult`** is now
    `{ ok; changed; files: FileChange[]; containers: ContainerChange[]; secrets: { generate: string[] }; diagnostics }`.
    `changed` is true when any file, container or secret would change.
  - **New `plan()` diagnostics:**
    - `home.invalid`: the home path contains `:`;
    - `docker.unavailable`, from a `RuntimeError`, with the hint
      `start Docker, and make sure your user can run "docker ps" (for example, add it to the docker group)`;
    - `compose.invalid`: `docker compose rejected the configuration: <compose error>`;
    - the preflight codes from Task 7.
  - **The test-only entry point `@mediaplane/engine/testing`** exports everything from
    `testing/fixtures.ts` and `testing/fakes.ts`.
  - **CLI: the `CliDeps` type:**
    `interface CliDeps { host: () => HostFacts; runtime: (home: string, project: string) => Runtime; probe: HostProbe }`.
  - **CLI: `run(argv, io, overrides?: Partial<CliDeps>)`.** The real dependencies are
    the default.
  - **CLI environment variables.** `MEDIAPLANE_HOME` and `MEDIAPLANE_COMPOSE_PROJECT` are
    each read with `""` treated as unset. The default project is `PROJECT_NAME`.
  - **CLI JSON error envelope.** When `--json` is given and an unexpected error is
    thrown, stdout gets
    `{ "schema": "mediaplane.error/v1", "ok": false, "error": { "message": "…" } }`
    and the exit code is 1. Without `--json` it is still `error: …` on stderr.
  - **The human plan** lists the files, then a `Containers:` block with one line per
    change (`+ create`, `~ recreate`, `> start`, `- remove`), then
    `Secrets to generate: …`. It ends with a summary such as
    `Plan: 1 file to write, 4 containers to change, 2 secrets to generate.`
    or `No changes.`. The old "Note: this version plans generated files only…" line is
    removed.

`plan()` runs in this order and never writes:

1. Check the home path.
2. Load and validate `stack.yaml`.
3. Check the secret references.
4. Resolve the stack.
5. Ask Docker for its versions and the project's containers.
6. Run preflight.
7. Render the files and diff them.
8. Read the secrets store.
9. Compute the secret values and ask Compose for the config hashes.
10. Plan the container changes.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/plan/containers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ContainerState } from '../runtime/types';
import { ownPorts, planContainers } from './containers';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function container(service: string, extra: Partial<ContainerState> = {}): ContainerState {
  return {
    service,
    id: `id-${service}`,
    state: 'running',
    health: '',
    configHash: HASH_A,
    published: [],
    ...extra,
  };
}

describe('planContainers', () => {
  it('creates, recreates, starts, keeps and removes', () => {
    const changes = planContainers(
      { jellyfin: HASH_A, radarr: HASH_B, sonarr: HASH_A, prowlarr: HASH_A },
      [
        container('radarr'),
        container('sonarr'),
        container('prowlarr', { state: 'exited' }),
        container('bazarr'),
      ],
    );
    expect(changes).toEqual([
      { service: 'jellyfin', action: 'create' },
      { service: 'prowlarr', action: 'start' },
      { service: 'radarr', action: 'recreate' },
      { service: 'sonarr', action: 'unchanged' },
      { service: 'bazarr', action: 'remove' },
    ]);
  });

  it('recreates a running container whose hash Compose did not record', () => {
    expect(planContainers({ sonarr: HASH_A }, [container('sonarr', { configHash: undefined })])).toEqual([
      { service: 'sonarr', action: 'recreate' },
    ]);
  });
});

describe('ownPorts', () => {
  it('collects every published address as a port key', () => {
    const ports = ownPorts([
      container('sonarr', { published: [{ address: '127.0.0.1', port: 8989, protocol: 'tcp' }] }),
      container('plex', { published: [{ address: '0.0.0.0', port: 32400, protocol: 'tcp' }] }),
    ]);
    expect([...ports].sort()).toEqual(['tcp/0.0.0.0:32400', 'tcp/127.0.0.1:8989']);
  });
});
```

Replace `packages/engine/src/plan/plan.test.ts` with:

```ts
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { portKey } from '../preflight/checks';
import type { HostProbe } from '../preflight/probe';
import type { Runtime } from '../runtime/types';
import { SECRETS_PATH } from '../secrets/store';
import { fakeProbe, fakeRuntime, running } from '../testing/fakes';
import { FIXTURE_HOST, fixtureCatalog } from '../testing/fixtures';
import { COMPOSE_PATH, plan } from './plan';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  qbittorrent: {}
  sonarr: {}
`;

const SERVICES = ['gluetun', 'jellyfin', 'qbittorrent', 'sonarr'];
const HASHES = Object.fromEntries(SERVICES.map((s, i) => [s, String(i).repeat(64)]));

async function makeHome({ stack = STACK, withSecret = true, withStore = false } = {}): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-plan-'));
  await writeFile(join(home, 'stack.yaml'), stack);
  if (withSecret) {
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'wg.key'), 'fake-wireguard-key-for-tests\n');
  }
  if (withStore) {
    await mkdir(join(home, 'state'));
    await writeFile(
      join(home, SECRETS_PATH),
      JSON.stringify({ version: 1, apps: { sonarr: { apiKey: '0'.repeat(32) } } }),
    );
  }
  return home;
}

function planFor(
  home: string,
  { runtime = fakeRuntime(), probe = fakeProbe() }: { runtime?: Runtime; probe?: HostProbe } = {},
) {
  return plan({ home, catalog: fixtureCatalog, host: FIXTURE_HOST, env: {}, runtime, probe });
}

describe('plan', () => {
  it('plans files, containers and secrets for a fresh home', async () => {
    const result = await planFor(await makeHome());
    expect(result).toMatchObject({ ok: true, changed: true, diagnostics: [] });
    expect(result.files).toEqual([expect.objectContaining({ path: COMPOSE_PATH, status: 'create' })]);
    expect(result.files[0]?.content).toContain('name: mediaplane');
    expect(result.containers).toEqual(SERVICES.map((service) => ({ service, action: 'create' })));
    expect(result.secrets).toEqual({ generate: ['sonarr.apiKey'] });
  });

  it('reports no changes when files, containers and secrets are current', async () => {
    const home = await makeHome({ withStore: true });
    const runtime = fakeRuntime({ hashes: { ok: true, hashes: HASHES }, containers: running(HASHES) });
    const first = await planFor(home, { runtime });
    await mkdir(join(home, 'generated'));
    await writeFile(join(home, COMPOSE_PATH), first.files[0]?.content ?? '');
    const result = await planFor(home, { runtime });
    expect(result).toMatchObject({ ok: true, changed: false, secrets: { generate: [] } });
    expect(result.files).toEqual([expect.objectContaining({ status: 'unchanged' })]);
    expect(result.containers.every((c) => c.action === 'unchanged')).toBe(true);
  });

  it('never writes to the home directory', async () => {
    const home = await makeHome();
    const before = (await readdir(home, { recursive: true })).sort();
    await planFor(home);
    expect((await readdir(home, { recursive: true })).sort()).toEqual(before);
  });

  it('explains a Docker it cannot reach', async () => {
    const runtime = fakeRuntime({ unavailable: 'cannot talk to Docker: connection refused' });
    const result = await planFor(await makeHome(), { runtime });
    expect(result).toMatchObject({ ok: false, changed: false, files: [], containers: [] });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'docker.unavailable',
        message: 'cannot talk to Docker: connection refused',
      }),
    );
  });

  it('stops on a preflight error', async () => {
    const probe = fakeProbe({ busyPorts: [portKey('tcp', '127.0.0.1', 8989)] });
    const result = await planFor(await makeHome(), { probe });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'preflight.port-in-use' })],
    });
  });

  it('reports a configuration Compose rejects', async () => {
    const runtime = fakeRuntime({ hashes: { ok: false, error: 'services.sonarr.ports must be a list' } });
    const result = await planFor(await makeHome(), { runtime });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'compose.invalid',
        message: 'docker compose rejected the configuration: services.sonarr.ports must be a list',
      }),
    );
  });

  it('rejects a home path containing ":"', async () => {
    const result = await plan({
      home: '/tmp/a:b',
      catalog: fixtureCatalog,
      host: FIXTURE_HOST,
      env: {},
      runtime: fakeRuntime(),
      probe: fakeProbe(),
    });
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'home.invalid' }] });
  });

  it('fails with the config error when stack.yaml is missing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-plan-'));
    expect(await planFor(home)).toMatchObject({
      ok: false,
      changed: false,
      files: [],
      diagnostics: [{ code: 'config.missing' }],
    });
  });

  it('fails when a referenced secret is missing', async () => {
    expect(await planFor(await makeHome({ withSecret: false }))).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'secret.missing', path: 'vpn.private_key' })],
    });
  });

  it('fails when the stack does not resolve', async () => {
    const stack = STACK.replace('  qbittorrent: {}\n', '');
    expect(await planFor(await makeHome({ stack }))).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'app.missing-capability' })],
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/plan`

Expected: FAIL. `./containers` cannot be resolved, and `plan()` neither accepts
`runtime`/`probe` nor returns `containers`/`secrets`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/plan/containers.ts`:

```ts
import { portKey } from '../preflight/checks';
import type { ContainerState } from '../runtime/types';
import { compare } from '../util/sort';

export type ContainerAction = 'create' | 'recreate' | 'start' | 'remove' | 'unchanged';

export interface ContainerChange {
  service: string;
  action: ContainerAction;
}

/**
 * What `docker compose up` will do to each service, given the config hash Compose
 * computes for the new configuration and the hash label on the existing containers.
 */
export function planContainers(
  desired: Record<string, string>,
  current: readonly ContainerState[],
): ContainerChange[] {
  const byService = new Map(current.map((container) => [container.service, container]));
  const changes: ContainerChange[] = Object.keys(desired)
    .sort(compare)
    .map((service): ContainerChange => {
      const container = byService.get(service);
      if (container === undefined) return { service, action: 'create' };
      if (container.configHash !== desired[service]) return { service, action: 'recreate' };
      if (container.state !== 'running') return { service, action: 'start' };
      return { service, action: 'unchanged' };
    });
  const removed = [...byService.keys()]
    .filter((service) => !Object.hasOwn(desired, service))
    .sort(compare)
    .map((service): ContainerChange => ({ service, action: 'remove' }));
  return [...changes, ...removed];
}

/** portKey()s the project's containers publish now. */
export function ownPorts(containers: readonly ContainerState[]): Set<string> {
  return new Set(
    containers.flatMap((container) =>
      container.published.map((p) => portKey(p.protocol, p.address, p.port)),
    ),
  );
}
```

Replace `packages/engine/src/plan/plan.ts` with:

```ts
import { join, resolve } from 'node:path';
import type { Catalog } from '../catalog/types';
import { loadConfigFile } from '../config/load';
import { checkSecretRefs } from '../config/secrets';
import { error, hasErrors, type Diagnostic } from '../diagnostics';
import type { HostFacts } from '../host/facts';
import { runPreflight } from '../preflight/checks';
import type { HostProbe } from '../preflight/probe';
import { renderCompose } from '../render/compose';
import { composeToYaml } from '../render/yaml';
import { resolveStack } from '../resolver/resolve';
import { RuntimeError, type ContainerState, type Runtime } from '../runtime/types';
import { readSecretStore } from '../secrets/store';
import { secretsToGenerate, secretValues } from '../secrets/values';
import { ownPorts, planContainers, type ContainerChange } from './containers';
import { diffFiles, type FileChange } from './files';

export const COMPOSE_PATH = 'generated/compose.yaml';

export interface PlanOptions {
  home: string;
  catalog: Catalog;
  host: HostFacts;
  env: NodeJS.ProcessEnv;
  runtime: Runtime;
  probe: HostProbe;
}

export interface PlanResult {
  /** False when any diagnostic is an error; files and containers are then empty. */
  ok: boolean;
  changed: boolean;
  files: FileChange[];
  containers: ContainerChange[];
  /** Names ("sonarr.apiKey"), never values. */
  secrets: { generate: string[] };
  diagnostics: Diagnostic[];
}

/** Everything apply would do, without doing it. Writes nothing. */
export async function plan(options: PlanOptions): Promise<PlanResult> {
  const home = resolve(options.home);
  if (home.includes(':')) {
    return failed([
      error('home.invalid', `the Mediaplane home ${home} must not contain ":"`, {
        hint: 'Docker uses ":" to separate volume paths; choose a path without one',
      }),
    ]);
  }
  const loaded = await loadConfigFile(join(home, 'stack.yaml'));
  if (!loaded.ok) return failed(loaded.diagnostics);

  const diagnostics = await checkSecretRefs(loaded.config, home, options.env);
  const resolved = resolveStack(loaded.config, options.catalog, options.host, home);
  diagnostics.push(...resolved.diagnostics);
  if (resolved.stack === undefined || hasErrors(diagnostics)) return failed(diagnostics);
  const stack = resolved.stack;

  let versions: { engine: string; compose: string };
  let current: ContainerState[];
  try {
    versions = await options.runtime.versions();
    current = await options.runtime.containers();
  } catch (cause) {
    if (!(cause instanceof RuntimeError)) throw cause;
    return failed([
      ...diagnostics,
      error('docker.unavailable', cause.message, {
        hint: 'start Docker, and make sure your user can run "docker ps" (for example, add it to the docker group)',
      }),
    ]);
  }

  diagnostics.push(
    ...(await runPreflight({ stack, versions, ownPorts: ownPorts(current) }, options.probe)),
  );
  if (hasErrors(diagnostics)) return failed(diagnostics);

  const compose = composeToYaml(renderCompose(stack), home);
  const files = await diffFiles(home, [{ path: COMPOSE_PATH, content: compose }]);
  const store = await readSecretStore(home);
  const generate = secretsToGenerate(stack, store);
  const hashes = await options.runtime.configHashes(
    compose,
    await secretValues(stack, store, options.env),
  );
  if (!hashes.ok) {
    return failed([
      ...diagnostics,
      error('compose.invalid', `docker compose rejected the configuration: ${hashes.error}`, {
        hint: 'if you have a compose.override.yaml next to stack.yaml, check it',
      }),
    ]);
  }
  const containers = planContainers(hashes.hashes, current);
  return {
    ok: true,
    changed:
      files.some((file) => file.status !== 'unchanged') ||
      containers.some((change) => change.action !== 'unchanged') ||
      generate.length > 0,
    files,
    containers,
    secrets: { generate },
    diagnostics,
  };
}

function failed(diagnostics: Diagnostic[]): PlanResult {
  return {
    ok: false,
    changed: false,
    files: [],
    containers: [],
    secrets: { generate: [] },
    diagnostics,
  };
}
```

`packages/engine/src/testing/index.ts`:

```ts
// Test helpers for this repo's tests only; not part of the engine's public API.
export * from './fixtures';
export * from './fakes';
```

In `packages/engine/package.json`, change `exports` to:

```json
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing/index.ts"
  },
```

Append `export * from './plan/containers';` to `packages/engine/src/index.ts`.

`docs/adr/0010-predict-container-changes-with-compose-hashes.md`:

```markdown
# 0010. Predict container changes with Compose's own config hash

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

`plan` must say which containers `apply` will create, recreate, start or remove, without
changing anything. Compose decides whether to recreate a container by comparing a hash
of the service's resolved configuration with the `com.docker.compose.config-hash` label
on the running container. Re-implementing that hash ourselves would drift from Compose's
behaviour, which can change between releases.

## Decision

`plan` asks Compose for the hashes directly: it pipes the rendered, unwritten
`compose.yaml`, plus the user's `compose.override.yaml` if present, into
`docker compose -f - config --hash '*'`, passing secret values through the subprocess
environment so nothing is written to disk. It then compares each service's hash with the
label on the project's containers from `docker compose ps --all --format json`.

## Consequences

- Plans match what `docker compose up` will actually do, including the effect of the
  user's override file and of changed secret values.
- `plan` needs a reachable Docker daemon. Without one it fails with an actionable
  `docker.unavailable` diagnostic rather than guessing.
- Verified on Docker 29.8 / Compose 5.5.1: a hash from stdin plus environment equals the
  label on a container created from the same files. An end-to-end test keeps this honest
  across Compose upgrades.
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine && pnpm typecheck`

Expected: the engine tests PASS. `tsc` still reports errors in `packages/cli/src/run.ts`
and its tests, because `plan()` now requires `runtime` and `probe`. The next steps fix
the CLI. Don't commit yet.

- [ ] **Step 5: Write the failing CLI tests**

The CLI tests take the real catalog, with fakes from `@mediaplane/engine/testing` for
the host, Docker and the probe. Replace `packages/cli/src/run.test.ts` with:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import { plan, type Runtime } from '@mediaplane/engine';
import { FIXTURE_HOST, fakeProbe, fakeRuntime, running } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { run, type CliDeps, type Io } from './run';
import { VERSION } from './version';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: {}
  qbittorrent: {}
`;

const SERVICES = ['gluetun', 'jellyfin', 'qbittorrent', 'sonarr'];
const HASHES = Object.fromEntries(SERVICES.map((s, i) => [s, String(i).repeat(64)]));

async function makeHome(stack = STACK): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-cli-'));
  await mkdir(join(home, 'secrets'));
  await writeFile(join(home, 'secrets', 'wg.key'), 'fake-wireguard-key-for-tests\n');
  await writeFile(join(home, 'stack.yaml'), stack);
  return home;
}

function deps(runtime: Runtime = fakeRuntime()): Partial<CliDeps> {
  return { host: () => FIXTURE_HOST, runtime: () => runtime, probe: fakeProbe() };
}

function capture(env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    env,
  };
  return { io, stdout: () => out.join(''), stderr: () => err.join('') };
}

describe('mediaplane plan', () => {
  it('exits 2 and shows files, containers and secrets for a fresh home', async () => {
    const term = capture();
    expect(await run(['plan', '--home', await makeHome()], term.io, deps())).toBe(2);
    expect(term.stdout()).toContain('+ generated/compose.yaml');
    expect(term.stdout()).toContain('Containers:\n');
    expect(term.stdout()).toContain('  + create    sonarr\n');
    expect(term.stdout()).toContain('Secrets to generate: qbittorrent.apiKey, sonarr.apiKey\n');
    expect(term.stdout()).toContain(
      'Plan: 1 file to write, 4 containers to change, 2 secrets to generate.',
    );
  });

  it('prints versioned JSON without file contents', async () => {
    const term = capture();
    expect(await run(['plan', '--home', await makeHome(), '--json'], term.io, deps())).toBe(2);
    const json = JSON.parse(term.stdout()) as {
      schema: string;
      ok: boolean;
      changed: boolean;
      files: Record<string, unknown>[];
      containers: { service: string; action: string }[];
      secrets: { generate: string[] };
    };
    expect(json).toMatchObject({ schema: 'mediaplane.plan/v1', ok: true, changed: true });
    expect(json.files[0]).toMatchObject({ path: 'generated/compose.yaml', status: 'create' });
    expect(json.files[0]).not.toHaveProperty('content');
    expect(json.containers).toContainEqual({ service: 'sonarr', action: 'create' });
    expect(json.secrets.generate).toEqual(['qbittorrent.apiKey', 'sonarr.apiKey']);
  });

  it('exits 0 when nothing would change', async () => {
    const home = await makeHome();
    await mkdir(join(home, 'state'));
    await writeFile(
      join(home, 'state', 'secrets.json'),
      JSON.stringify({
        version: 1,
        apps: { sonarr: { apiKey: '0'.repeat(32) }, qbittorrent: { apiKey: `qbt_${'0'.repeat(28)}` } },
      }),
    );
    const runtime = fakeRuntime({ hashes: { ok: true, hashes: HASHES }, containers: running(HASHES) });
    const current = await plan({ home, catalog, host: FIXTURE_HOST, env: {}, runtime, probe: fakeProbe() });
    await mkdir(join(home, 'generated'));
    await writeFile(join(home, 'generated', 'compose.yaml'), current.files[0]?.content ?? '');
    const term = capture();
    expect(await run(['plan', '--home', home], term.io, deps(runtime))).toBe(0);
    expect(term.stdout()).toBe('No changes.\n');
  });

  it('exits 1 with actionable errors on stderr', async () => {
    const term = capture();
    const home = await makeHome(STACK.replace('sonarr: {}', 'sonar: {}'));
    expect(await run(['plan', '--home', home], term.io, deps())).toBe(1);
    expect(term.stderr()).toContain('error: unknown app "sonar"');
    expect(term.stderr()).toContain('hint: did you mean "sonarr"?');
  });

  it('explains a Docker it cannot reach', async () => {
    const term = capture();
    const runtime = fakeRuntime({ unavailable: 'cannot talk to Docker: connection refused' });
    expect(await run(['plan', '--home', await makeHome()], term.io, deps(runtime))).toBe(1);
    expect(term.stderr()).toContain('error: cannot talk to Docker: connection refused');
    expect(term.stderr()).toContain('hint: start Docker');
  });

  it('reads the home directory from MEDIAPLANE_HOME', async () => {
    const term = capture({ MEDIAPLANE_HOME: await makeHome() });
    expect(await run(['plan'], term.io, deps())).toBe(2);
  });

  it('treats an empty MEDIAPLANE_HOME as unset', async () => {
    const term = capture({ MEDIAPLANE_HOME: '' });
    expect(await run(['plan'], term.io, deps())).toBe(1);
    expect(term.stderr()).toContain('no stack.yaml at /opt/mediaplane/stack.yaml');
  });

  it('passes MEDIAPLANE_COMPOSE_PROJECT to the runtime', async () => {
    const projects: string[] = [];
    const term = capture({ MEDIAPLANE_COMPOSE_PROJECT: 'mediaplane-test' });
    await run(['plan', '--home', await makeHome()], term.io, {
      ...deps(),
      runtime: (_home, project) => {
        projects.push(project);
        return fakeRuntime();
      },
    });
    expect(projects).toEqual(['mediaplane-test']);
  });

  it('prints its version', async () => {
    const term = capture();
    expect(await run(['--version'], term.io, deps())).toBe(0);
    expect(term.stdout().trim()).toBe(VERSION);
  });

  it('reports unexpected I/O errors as a one-line error naming the file', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-cli-'));
    await mkdir(join(home, 'stack.yaml'));
    const term = capture();
    expect(await run(['plan', '--home', home], term.io, deps())).toBe(1);
    expect(term.stderr()).toBe(`error: cannot read ${join(home, 'stack.yaml')} (EISDIR)\n`);
    expect(term.stdout()).toBe('');
  });

  it('reports unexpected errors as a JSON envelope with --json', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-cli-'));
    await mkdir(join(home, 'stack.yaml'));
    const term = capture();
    expect(await run(['plan', '--home', home, '--json'], term.io, deps())).toBe(1);
    expect(JSON.parse(term.stdout())).toEqual({
      schema: 'mediaplane.error/v1',
      ok: false,
      error: { message: `cannot read ${join(home, 'stack.yaml')} (EISDIR)` },
    });
    expect(term.stderr()).toBe('');
  });
});
```

The spawned tests in `packages/cli/src/main.test.ts` run the real CLI against the real
Docker, so their stack must pass preflight on any machine. That needs four things:

- **A temporary data folder.**
- **The apps run as the current user.** The default uid 1000 may not own the
  temporary folder. This dev box runs as uid 1002, and GitHub's runners as 1001.
- **No VPN**, so `/dev/net/tun` isn't needed, and localhost binding.
- **An isolated Compose project name.**

Replace `packages/cli/src/main.test.ts` with:

```ts
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from './version';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
// Real Docker, but never the real stack: plan only reads, under its own project name.
const ENV = { ...process.env, MEDIAPLANE_COMPOSE_PROJECT: `mediaplane-test-${process.pid}` };

function stackFor(data: string): string {
  return `version: 1
user: { uid: ${process.getuid?.() ?? 1000}, gid: ${process.getgid?.() ?? 1000} }
paths: { data: ${data} }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: {}
  qbittorrent: { vpn: false }
`;
}

function spawnMain(...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', MAIN, ...args], {
    encoding: 'utf8',
    env: ENV,
  });
}

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'mediaplane-main-'));
  mkdirSync(join(home, 'data'));
  writeFileSync(join(home, 'stack.yaml'), stackFor(join(home, 'data')));
  return home;
}

describe('main', () => {
  it('runs as a real process and exits with the command status', () => {
    const result = spawnMain('--version');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
  });

  it('exits 1 for a plan that fails, with nothing on stdout', () => {
    const home = mkdtempSync(join(tmpdir(), 'mediaplane-main-'));
    const result = spawnMain('plan', '--home', home);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
  });

  it('exits 2 for a plan that would change something', () => {
    const result = spawnMain('plan', '--home', freshHome());
    expect(result.stderr).not.toContain('error:');
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('+ generated/compose.yaml');
    expect(result.stdout).toContain('  + create    sonarr\n');
  });

  it('keeps the plan exit code when stdout is closed early', () => {
    const home = freshHome();
    const result = spawnSync(
      'bash',
      [
        '-c',
        `"${process.execPath}" --import tsx "${MAIN}" plan --home "${home}" | head -1; echo "status=\${PIPESTATUS[0]}"`,
      ],
      { encoding: 'utf8', env: ENV },
    );
    expect(result.stdout).toContain('status=2');
    expect(result.stderr).not.toContain('EPIPE');
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm vitest run packages/cli`

Expected: FAIL. `tsc` would reject the third argument to `run`, and the output has no
`Containers:` block and no JSON envelope.

- [ ] **Step 7: Write the CLI implementation**

Replace `packages/cli/src/output.ts` with:

```ts
import type { ContainerAction, Diagnostic, PlanResult } from '@mediaplane/engine';
import type { Io } from './run';

export const PLAN_JSON_SCHEMA = 'mediaplane.plan/v1';
export const ERROR_JSON_SCHEMA = 'mediaplane.error/v1';

const MARKS: Record<ContainerAction, string> = {
  create: '+',
  recreate: '~',
  start: '>',
  remove: '-',
  unchanged: ' ',
};

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const hint = diagnostic.hint === undefined ? '' : `\n  hint: ${diagnostic.hint}`;
  return `${diagnostic.severity}: ${diagnostic.message}${hint}\n`;
}

export function printError(message: string, options: { json: boolean }, io: Io): void {
  if (options.json) {
    io.stdout(
      `${JSON.stringify({ schema: ERROR_JSON_SCHEMA, ok: false, error: { message } }, null, 2)}\n`,
    );
    return;
  }
  io.stderr(`error: ${message}\n`);
}

export function printPlan(result: PlanResult, options: { json: boolean }, io: Io): void {
  if (options.json) {
    const files = result.files.map(({ content, ...file }) => file);
    io.stdout(`${JSON.stringify({ schema: PLAN_JSON_SCHEMA, ...result, files }, null, 2)}\n`);
    return;
  }
  for (const diagnostic of result.diagnostics) io.stderr(formatDiagnostic(diagnostic));
  if (!result.ok) {
    io.stderr('\nPlan failed. Fix the errors above and run it again.\n');
    return;
  }
  const files = result.files.filter((file) => file.status !== 'unchanged');
  for (const file of files) {
    io.stdout(`${file.status === 'create' ? '+' : '~'} ${file.path}\n${file.diff}\n`);
  }
  const containers = result.containers.filter((change) => change.action !== 'unchanged');
  if (containers.length > 0) {
    io.stdout('Containers:\n');
    for (const change of containers) {
      io.stdout(`  ${MARKS[change.action]} ${change.action.padEnd(9)} ${change.service}\n`);
    }
  }
  const generate = result.secrets.generate;
  if (generate.length > 0) io.stdout(`Secrets to generate: ${generate.join(', ')}\n`);
  const parts = [
    count(files.length, 'file', 'to write'),
    count(containers.length, 'container', 'to change'),
    count(generate.length, 'secret', 'to generate'),
  ].filter((part): part is string => part !== undefined);
  io.stdout(parts.length === 0 ? 'No changes.\n' : `Plan: ${parts.join(', ')}.\n`);
}

function count(n: number, noun: string, verb: string): string | undefined {
  return n === 0 ? undefined : `${n} ${noun}${n === 1 ? '' : 's'} ${verb}`;
}
```

Replace `packages/cli/src/run.ts` with:

```ts
import { resolve } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  createDockerRuntime,
  detectHostFacts,
  nodeProbe,
  plan,
  PROJECT_NAME,
  type HostFacts,
  type HostProbe,
  type Runtime,
} from '@mediaplane/engine';
import { Command, CommanderError } from 'commander';
import { printError, printPlan } from './output';
import { VERSION } from './version';

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  env: NodeJS.ProcessEnv;
}

/** What the CLI talks to: the real host by default, fakes in tests. */
export interface CliDeps {
  host: () => HostFacts;
  runtime: (home: string, project: string) => Runtime;
  probe: HostProbe;
}

export const DEFAULT_HOME = '/opt/mediaplane';

const defaultDeps: CliDeps = {
  host: () => detectHostFacts(),
  runtime: (home, project) => createDockerRuntime({ home, project }),
  probe: nodeProbe,
};

/** An environment variable's value, treating "" as unset. */
function setting(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}

/** Run the CLI with user arguments (no node/script prefix) and return the exit code. */
export async function run(
  argv: readonly string[],
  io: Io,
  overrides: Partial<CliDeps> = {},
): Promise<number> {
  const deps: CliDeps = { ...defaultDeps, ...overrides };
  const json = argv.includes('--json');
  const project = setting(io.env, 'MEDIAPLANE_COMPOSE_PROJECT') ?? PROJECT_NAME;
  let exitCode = 0;
  const program = new Command('mediaplane')
    .description('Deploy and wire a self-hosted media stack from one stack.yaml')
    .version(VERSION)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        io.stdout(text);
      },
      writeErr: (text) => {
        io.stderr(text);
      },
    });

  program
    .command('plan')
    .description('Show what apply would change, without changing anything')
    .option(
      '--home <dir>',
      'Mediaplane home directory',
      setting(io.env, 'MEDIAPLANE_HOME') ?? DEFAULT_HOME,
    )
    .option('--json', 'print machine-readable JSON')
    .action(async (options: { home: string; json?: boolean }) => {
      const home = resolve(options.home);
      const result = await plan({
        home,
        catalog,
        host: deps.host(),
        env: io.env,
        runtime: deps.runtime(home, project),
        probe: deps.probe,
      });
      printPlan(result, { json: options.json === true }, io);
      exitCode = result.ok ? (result.changed ? 2 : 0) : 1;
    });

  try {
    await program.parseAsync([...argv], { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return cause.exitCode;
    // Anything else (an unreadable stack.yaml, an unsupported CPU) is described, not crashed on.
    printError(cause instanceof Error ? cause.message : String(cause), { json }, io);
    return 1;
  }
  return exitCode;
}
```

- [ ] **Step 8: Run them to verify they pass**

Run: `pnpm vitest run packages/cli && pnpm typecheck`

Expected: PASS. The spawned tests in `main.test.ts` use the real Docker. If Docker is
unavailable on a machine, they fail with `docker.unavailable`, which is expected. This
repo's CI runners and dev machine have Docker.

- [ ] **Step 9: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat: plan containers with Compose's config hash and show them in the CLI"
```

---

### Task 9: End-to-end tests against real Docker, CI job, and docs

**Files:**
- Create: `vitest.e2e.config.ts`, `test/e2e/plan.e2e.test.ts`
- Modify:
  - the root `package.json` (a `test:e2e` script, and workspace devDependencies so
    `test/` can import the packages) and `pnpm-lock.yaml`;
  - `tsconfig.json` (include `test/**/*.ts`);
  - `vitest.config.ts` (coverage scope);
  - `.github/workflows/ci.yml` (`e2e` job);
  - `README.md` ("Try it" section) and `CONTRIBUTING.md` (end-to-end tests).

**Interfaces:**
- **Consumes:**
  - from `@mediaplane/engine`: `plan`, `createDockerRuntime`, `nodeExec`, `nodeProbe`
    and `detectHostFacts`;
  - from `@mediaplane/catalog`: `catalog`.
- **Produces:**
  - **`pnpm test:e2e`**, which needs Docker. Each run uses its own Compose project,
    `mediaplane-e2e-<pid>`. The hash test creates one never-started `busybox`
    container in that project and removes it afterwards. Everything else only plans.
  - **Unit-test coverage thresholds** now cover every engine source folder except
    `testing/`.

These end-to-end tests check two things unit tests can't:

- Compose accepts what Mediaplane renders, together with the user's override file.
- ADR 0010's central assumption holds: the hash Compose predicts from stdin and the
  environment equals the label it puts on a container it creates.

That assumption was verified by hand on 2026-10-09 with Docker 29.8 and Compose 5.5.1,
using the same busybox image.

- [ ] **Step 1: Add the end-to-end harness**

Let tests at the repository root import the workspace packages:

```bash
pnpm add -Dw '@mediaplane/engine@workspace:*' '@mediaplane/catalog@workspace:*'
```

Expected: the root `package.json` gains both under `devDependencies` as
`"workspace:*"`, and `pnpm-lock.yaml` is updated. No package is downloaded.

`vitest.e2e.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
```

Add to the root `package.json` `scripts`, keeping the existing ones:

```json
    "test:e2e": "vitest run --config vitest.e2e.config.ts"
```

In `tsconfig.json`, change `include` to
`["packages/*/src/**/*.ts", "catalog/**/*.ts", "test/**/*.ts", "vitest.config.ts", "vitest.e2e.config.ts"]`.

In `vitest.config.ts`, change the coverage `include` and `exclude` to:

```ts
      include: ['packages/engine/src/**/*.ts'],
      exclude: ['**/*.test.ts', 'packages/engine/src/testing/**', 'packages/engine/src/index.ts'],
```

- [ ] **Step 2: Write the end-to-end tests**

`test/e2e/plan.e2e.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  createDockerRuntime,
  detectHostFacts,
  nodeExec,
  nodeProbe,
  plan,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';

const PROJECT = `mediaplane-e2e-${process.pid}`;

/**
 * The M1 video stack without the VPN (the VPN gets its own end-to-end test in Slice 3).
 * The apps run as the current user, who owns the temporary data folder.
 */
function stackFor(data: string): string {
  return `version: 1
user: { uid: ${process.getuid?.() ?? 1000}, gid: ${process.getgid?.() ?? 1000} }
paths: { data: ${data} }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: {}
  radarr: {}
  prowlarr: {}
  qbittorrent: { vpn: false }
  seerr: {}
`;
}

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-'));
  await mkdir(join(home, 'data'));
  await writeFile(join(home, 'stack.yaml'), stackFor(join(home, 'data')));
  return home;
}

function planFor(home: string) {
  return plan({
    home,
    catalog,
    host: detectHostFacts(),
    env: process.env,
    runtime: createDockerRuntime({ home, project: PROJECT }),
    probe: nodeProbe,
  });
}

describe('plan against real Docker', () => {
  it('plans the whole video stack, accepted by Compose', async () => {
    const result = await planFor(await makeHome());
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.containers.map((c) => [c.service, c.action])).toEqual([
      ['byparr', 'create'],
      ['jellyfin', 'create'],
      ['prowlarr', 'create'],
      ['qbittorrent', 'create'],
      ['radarr', 'create'],
      ['seerr', 'create'],
      ['sonarr', 'create'],
    ]);
    expect(result.secrets.generate).toEqual([
      'prowlarr.apiKey',
      'qbittorrent.apiKey',
      'radarr.apiKey',
      'seerr.apiKey',
      'sonarr.apiKey',
    ]);
  });

  it("includes the user's compose.override.yaml in the hashes", async () => {
    const home = await makeHome();
    const compose = (await planFor(home)).files[0]?.content ?? '';
    const runtime = createDockerRuntime({ home, project: PROJECT });
    const before = await runtime.configHashes(compose, {});
    await writeFile(
      join(home, 'compose.override.yaml'),
      'services:\n  sonarr:\n    environment:\n      FAKE_EXTRA: "1"\n',
    );
    const after = await runtime.configHashes(compose, {});
    if (!before.ok || !after.ok) throw new Error('compose rejected the configuration');
    expect(after.hashes.sonarr).not.toBe(before.hashes.sonarr);
    expect(after.hashes.radarr).toBe(before.hashes.radarr);
    expect((await planFor(home)).ok).toBe(true);
  });

  it('predicts the config hash Compose records on the container it creates', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-'));
    const compose = [
      'services:',
      '  probe:',
      '    image: busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e',
      '    command: ["true"]',
      '    environment:',
      '      FAKE_SECRET: "${MP_FAKE_SECRET}"',
      '',
    ].join('\n');
    const values = { MP_FAKE_SECRET: 'fake-secret-value' };
    // Its own project, so a failed clean-up can't leak into the other tests' plans.
    const project = `${PROJECT}-hash`;
    const runtime = createDockerRuntime({ home, project });
    const predicted = await runtime.configHashes(compose, values);
    await writeFile(join(home, 'compose.yaml'), compose);
    try {
      const created = await nodeExec(
        'docker',
        [
          'compose', '-p', project, '--project-directory', home,
          '-f', join(home, 'compose.yaml'), 'create',
        ],
        { env: { ...process.env, ...values }, cwd: '/' },
      );
      expect(created.code, created.stderr).toBe(0);
      const containers = await runtime.containers();
      expect(containers).toEqual([
        expect.objectContaining({ service: 'probe', state: 'created', published: [] }),
      ]);
      expect(predicted).toEqual({ ok: true, hashes: { probe: containers[0]?.configHash } });
    } finally {
      await nodeExec('docker', ['compose', '-p', project, 'down', '--remove-orphans'], {
        cwd: '/',
      });
    }
  });

  it('reports a compose.override.yaml that Compose rejects', async () => {
    const home = await makeHome();
    await writeFile(join(home, 'compose.override.yaml'), 'services:\n  sonarr:\n    ports: 5\n');
    const result = await planFor(home);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('compose.invalid');
  });

  it('notices a port something else on the host is using', async () => {
    const server = createServer();
    await new Promise<void>((done) => server.listen(8989, '127.0.0.1', done));
    try {
      const result = await planFor(await makeHome());
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'preflight.port-in-use', path: 'apps.sonarr.port' }),
      );
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});
```

- [ ] **Step 3: Run them locally (this aarch64 machine has Docker)**

Run: `pnpm test:e2e`

Expected: PASS (5 tests). If the first test fails, read the diagnostics it prints. A
`preflight.*` error points at this host, for example an occupied port. Any other error
is a bug. If the hash test fails on the hash comparison itself, stop and report it:
that would mean ADR 0010's approach doesn't hold on this Compose version.

Afterwards, check nothing was left behind:

```bash
docker ps -a --filter "label=com.docker.compose.project" --format '{{.Label "com.docker.compose.project"}}' | grep mediaplane-e2e || echo clean
```

Expected: `clean`.

- [ ] **Step 4: Add the CI job**

Add this job to `.github/workflows/ci.yml`, after the `check` job. Reuse the same
pinned action SHAs:

```yaml
  e2e:
    name: End-to-end (real Docker)
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: docker version && docker compose version
      - run: pnpm test:e2e
```

- [ ] **Step 5: Update the docs**

In `README.md`, replace the whole `## Try it (from source)` section with:

````markdown
## Try it (from source)

`mediaplane plan` already checks a real host and shows exactly what `apply` would do:

- the Compose file it would write;
- the containers it would create, recreate, start or remove;
- the secrets it would generate.

It changes nothing; `apply` comes in the next release. You need Docker (Engine 24 or
newer, with the Compose plugin 2.24 or newer).

```bash
corepack enable && pnpm install
mkdir -p .mediaplane-dev/data .mediaplane-dev/secrets
printf 'fake-wireguard-key\n' > .mediaplane-dev/secrets/wg.key
cat > .mediaplane-dev/stack.yaml <<EOF
version: 1
user: { uid: $(id -u), gid: $(id -g) }
paths: { data: $PWD/.mediaplane-dev/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: {}
  radarr: {}
  prowlarr: {}
  qbittorrent: {}
  seerr: {}
EOF
pnpm --silent mediaplane plan --home .mediaplane-dev
```

The `user:` line makes the apps run as you, so they can write to the data folder you
just created. `plan` exits with `0` when nothing would change, `2` when it would change
something, and `1` on errors. Add `--json` for machine-readable output.
````

In `CONTRIBUTING.md`, add this row to the "Everyday commands" table:

```markdown
| `pnpm test:e2e`      | End-to-end tests against real Docker    |
```

Add this paragraph after the table:

```markdown
The unit tests use in-memory fakes for Docker and the host. The spawned-CLI tests in
`packages/cli/src/main.test.ts` and `pnpm test:e2e` use the real Docker, under their own
Compose project names (`MEDIAPLANE_COMPOSE_PROJECT`), so they never touch a real stack.
```

- [ ] **Step 6: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm test:e2e
git add -A
git commit -m "test(e2e): plan against real Docker in CI, and document it"
```

If `pnpm test:coverage` is below a threshold now that more folders count, add a focused
test for each uncovered behaviour. Do not lower the thresholds.

---

## Slice 2a completion checklist

- [ ] `pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm test:e2e`
  passes on this aarch64 machine.
- [ ] `pnpm --silent mediaplane plan --home .mediaplane-dev` (the README stack) prints
  the compose diff, a `Containers:` block with 8 creates and the secrets to generate,
  then exits with 2. It must not create any file under `.mediaplane-dev/` other than the
  ones the README commands created.
- [ ] Every task is committed, and `git status` is clean.
- [ ] Nothing has been pushed. Report to the owner. Pushing runs CI, including the new
  `e2e` job, for the first time.
