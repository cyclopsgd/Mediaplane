# Deploying with automation

Mediaplane works on its own: `install.sh`, then `init`, `plan` and `apply`, as the
[README](../README.md) shows. Automation such as Ansible, a CI job or a shell script runs
the same commands. This page is the contract such a script can rely on, and a short
Ansible example. Mediaplane ships no Ansible role or collection: the example is all
there is, and nothing in Mediaplane needs Ansible.

## What a script can rely on

- **The commands ask nothing without a terminal.** Run from a script, with no terminal
  on its standard input and output, a command that would need an answer fails at once
  and says which flag it needs: `apply` needs `--yes`, and `init` needs at least
  `--media-server` and `--data`. `docker exec` without `-t`, Ansible's `command` module,
  and a CI job all run without a terminal.
- **`--json` prints one document, and nothing else, on standard output:** the command's
  own, or `mediaplane.error/v1` when it stops before it can print its own, a mistyped
  option included. Each names its shape (`schema`) and says whether the command did what
  it was asked (`ok`). The exit code says the same, except that `plan` and `drift` print
  `ok: true` and exit 2 when they found something, and `vpn-check` prints `ok: true` and
  exits 1 on a leak. The [`--json` reference](reference/json.md) lists every field, and
  each document has a JSON Schema beside it, in [`reference/json/`](reference/json/).
- **The exit codes say what happened,** the same way every time. The
  [CLI reference](reference/cli.md) lists each command's. The ones a playbook uses:
  - `plan`: 0 when nothing would change, 2 when `apply` would change something (or an
    app is still waiting for its health check), 1 on an error.
  - `apply`: 0 when it applied, or had nothing to do; 1 when a step failed.
  - `drift`: 0 when nothing drifted and every resource and secret was checked, 2 when
    something drifted or couldn't be checked, 1 on an error.
  - `keep`: 0 when it kept the change or, with `managed_by: external`, gave the line to
    add; 1 when nothing was kept (the value hasn't drifted, or can't be kept) or on an
    error.
  - `migrate`: 0 when `stack.yaml` is now the version this release writes, or already
    was; 1 when it wasn't rewritten (a newer or unknown version, an unwritable file), or
    on an error. With `managed_by: external` and a change due, it is 1 too (code
    `migrate.external`), and `text` holds the file as it should be.
  - `vpn-check`: 0 when qBittorrent reaches the internet only through the VPN; 1 on a
    leak or the VPN down (`ok` is still true; `verdict` says which), or on an error.
  - `status`, `history` and `credentials`: 0, or 1 on an error, which includes no such
    record or app.
- **A folder or a named pipe where `stack.yaml` should be fails at once,** with exit 1,
  and never waits for it. The diagnostic's code is `config.not-a-file`, or
  `keep.stack-file` for `keep` and `migrate.stack-file` for `migrate`.
- **A second `apply` changes nothing.** With nothing to do, `apply --yes --json` exits 0
  with `"changed": false` and `"outcome": "no-changes"`, and writes no change record.
  That is a playbook's `changed_when`.
- **Within v1, a document only grows.** A later release may add a field, or a value to a
  field's values (`remove` was added to `wiring[].action`), but never changes what one
  means: that would be v2. So read the fields you know, ignore the others, and stop at a
  value you don't know rather than guess what it means.
- **A diagnostic's `code` is stable;** its `message` is for people, and may change. The
  [`--json` reference](reference/json.md) lists the codes a script is most likely to act
  on.
- **No secret is ever printed,** in `--json` or otherwise, but by `credentials`: the
  admin password, only with `--reveal` under `--json`. A key or password in a file you
  give (`{ file: … }` in `stack.yaml`) is read, never printed or logged.

What a script should not rely on:

- the human output (without `--json`): its words change;
- the files in `state/`: they are Mediaplane's. `state/resources.json`
  (`mediaplane.resources/v1`) records, for each resource Mediaplane made, its id in its
  app, its name, the managed fields as last applied, and the names of its secrets, of
  those Mediaplane gave the app in place of ones it made itself (`given`), and of their
  last checks (`checks`): never a value. `mediaplane history <id> --json` prints a change
  record, and is the way to read one;
- a change record of a later release: `history <id> --json` shows the fields this
  release knows, and the rest stay in its file. A record this release can't read at all,
  such as one with a value it doesn't know, is listed under `unreadable` by
  `history --json`, and `history <id>` exits 1, saying so.

## The commands, as a script runs them

Mediaplane runs in its own container, `mediaplane`, so a script runs each command with
`docker exec`, without `-t`:

```bash
docker exec mediaplane mediaplane plan --json
docker exec mediaplane mediaplane apply --yes --json
docker exec mediaplane mediaplane drift --json
```

From a checkout, `pnpm --silent mediaplane <command> --json` does the same, with
`--home` for the home.

- **`plan`, then `apply`.** `plan --json` exits 2 when there is something to do.
  `apply --yes --json` then does it; its `actions` say what each step did, and its
  `recordId` names the change record.
- **Take an app out** by taking its line out of `stack.yaml`. `plan` lists its container
  as `remove`, and each resource Mediaplane made for it in the other apps as a wiring
  `remove`; `apply` removes them (each one's wire action says `removed` in its `detail`),
  and keeps the app's `appdata/`. What it leaves, such
  as a qBittorrent category that holds a torrent, `drift` reports as `left`, with `stays`
  saying why.
- **Rebuild a host** from `stack.yaml`, `secrets/`, `appdata/` and the data folder:
  install Mediaplane on the new host with the same home, then `plan` and `apply` as
  above. `plan` lists the keys it recovers from the apps' appdata
  (`secrets.recover`), and a new admin password to generate when the old one went with
  `state/` (the warning `secrets.admin-password-lost`); `apply` finds each resource it
  made by name, and adopts it: its wire action in `actions` says `adopted` in its
  `detail`, not `created`. A wire action that is `done` and names a resource says one
  of a few words there, stable within v1, which the [`--json` reference](reference/json.md) lists. The
  [rebuilding a host](runbooks/rebuilding-a-host.md) runbook has the details.
- **Watch for drift** with `drift --json` on a schedule: exit 2 means look.

## When automation owns `stack.yaml`

A playbook that templates `stack.yaml` owns it: add `managed_by: external`, and
Mediaplane never writes the file.

- `mediaplane keep` (Keep mine) then writes nothing in `stack.yaml`, and gives the line
  to add instead: `line` in `mediaplane.keep/v1`, with `"written": false` and the warning
  `keep.external`. Add the line to your template. Until `stack.yaml` holds it, `apply`
  puts back what it applied.
- `mediaplane migrate` writes nothing either, and exits 1 (`migrate.external`) when there
  is a change to make, giving the file as it should be, as `text`. Put that in your
  template.

## Secrets

`stack.yaml` never holds a secret: it names a file in the home (`{ file: secrets/… }`) or
an environment variable (`{ env: … }`). A playbook writes those files, mode 0600, owned
by the home's user, from its own vault; an environment variable must be set in
Mediaplane's container, which `deploy/mediaplane.compose.yaml` would need to pass on, so
a file is the simpler way. The keys and the admin password Mediaplane generates stay in
`state/secrets.json`, and it never makes new ones on its own: a new admin password is
`apply --rotate admin.password`.

## An example with Ansible

A short example, for one host where Mediaplane is installed already
([`deploy/README.md`](../deploy/README.md)), run as the user who owns the home. It
templates `stack.yaml`, asks `plan` whether there is anything to do, and applies only
then, reporting a change only when `apply` made one:

```yaml
- name: Deploy the media stack with Mediaplane
  hosts: media
  vars:
    mediaplane_home: /opt/mediaplane
  tasks:
    - name: Write stack.yaml, with managed_by external in it
      ansible.builtin.template:
        src: stack.yaml.j2
        dest: '{{ mediaplane_home }}/stack.yaml'
        mode: '0644'

    - name: See what apply would change
      ansible.builtin.command: docker exec mediaplane mediaplane plan --json
      register: plan
      changed_when: false
      failed_when: plan.rc not in [0, 2]

    - name: Apply it
      ansible.builtin.command: docker exec mediaplane mediaplane apply --yes --json
      register: applied
      when: plan.rc == 2
      changed_when: (applied.stdout | from_json).changed
```

Run it again and the second run reports nothing changed: `plan` exits 0, and `apply`
doesn't run. To rebuild a host, run the same play against the new host once its home
holds `stack.yaml`, `secrets/` and `appdata/`.

An end-to-end test (`test/e2e/playbook.e2e.test.ts`) runs this contract against real
Docker, as the example does: it deploys a stack, takes an app out, and rebuilds the host,
reading only the exit codes and the documents, each checked against its published JSON
Schema.
