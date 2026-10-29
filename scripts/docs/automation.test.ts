import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createProgram, defaultDeps, EXIT_CODES } from '../../packages/cli/src/run';
import { ROOT } from '../root';

/** docs/automation.md: the guide to deploying with automation. */
const guide = readFileSync(join(ROOT, 'docs', 'automation.md'), 'utf8');

/** The guide's fenced blocks of `language`, in order. */
function blocks(language: string): string[] {
  return [
    ...guide.matchAll(new RegExp(`^\`\`\`${language}\n([\\s\\S]*?)^\`\`\`$`, 'gm')),
  ].map((match) => match[1] ?? '');
}

interface Task {
  name?: unknown;
  'ansible.builtin.command'?: unknown;
  'ansible.builtin.template'?: unknown;
}

/** The exit-code bullets under "The exit codes say what happened", by command. */
function exitCodeBullets(): Map<string, string> {
  const section = guide.slice(
    guide.indexOf('**The exit codes say what happened,**'),
    guide.indexOf('**A folder or a named pipe'),
  );
  const bullets = new Map<string, string>();
  for (const match of section.matchAll(
    /^ {2}- (`[^:]+`): ([\s\S]*?)(?=^ {2}- |$(?![\s\S]))/gm,
  )) {
    const names = [...(match[1] ?? '').matchAll(/`([a-z-]+)`/g)].map((m) => m[1] ?? '');
    for (const name of names) bullets.set(name, (match[2] ?? '').replace(/\s+/g, ' '));
  }
  return bullets;
}

/** The CLI as the guide's commands meet it. */
const cli = createProgram(
  { stdout: () => undefined, stderr: () => undefined, env: {} },
  defaultDeps({}),
  () => undefined,
);

describe('the automation guide (docs/automation.md)', () => {
  it('has one short Ansible play, in YAML, each task named', () => {
    const yaml = blocks('yaml');
    expect(yaml).toHaveLength(1);
    const plays = parse(yaml[0] ?? '') as { hosts?: unknown; tasks?: Task[] }[];
    expect(plays).toHaveLength(1);
    const tasks = plays[0]?.tasks ?? [];
    expect(tasks.length).toBeGreaterThan(0);
    expect(typeof plays[0]?.hosts).toBe('string');
    for (const task of tasks) {
      expect(typeof task.name, JSON.stringify(task)).toBe('string');
      expect(
        task['ansible.builtin.command'] ?? task['ansible.builtin.template'],
        JSON.stringify(task),
      ).toBeDefined();
    }
  });

  it('runs only commands and options the CLI has, as a script runs them', () => {
    const lines = [
      ...guide.matchAll(
        /docker exec (\S+ )*mediaplane mediaplane ([a-z-]+)((?: --[a-z-]+)*)/g,
      ),
    ];
    expect(lines.length).toBeGreaterThan(3);
    for (const [line, flags, name = '', options = ''] of lines) {
      // Without a terminal (no -t): a script's way, which asks nothing.
      expect(flags, line).toBeUndefined();
      const command = cli.commands.find((c) => c.name() === name);
      expect(command, line).toBeDefined();
      const given = options.split(' ').filter((option) => option !== '');
      for (const option of given) {
        expect(
          command?.options.some((o) => o.long === option),
          `${line}: ${option}`,
        ).toBe(true);
      }
      expect(given, line).toContain('--json');
      // Without a terminal, apply asks nothing only with --yes.
      if (name === 'apply') expect(given, line).toContain('--yes');
    }
  });

  it("takes plan's exit codes as the CLI says them: 0 and 2 succeed", () => {
    expect((EXIT_CODES.plan ?? []).map((code) => code.split(':')[0])).toEqual([
      '0',
      '2',
      '1',
    ]);
    expect(blocks('yaml')[0]).toContain('failed_when: plan.rc not in [0, 2]');
    expect(blocks('yaml')[0]).toContain(
      'changed_when: (applied.stdout | from_json).changed',
    );
  });

  it("states every command's exit codes as the CLI says them", () => {
    const bullets = exitCodeBullets();
    expect([...bullets.keys()].sort()).toEqual(
      [
        'apply',
        'credentials',
        'drift',
        'history',
        'keep',
        'migrate',
        'plan',
        'status',
        'vpn-check',
      ].sort(),
    );
    for (const [name, text] of bullets) {
      // The codes the guide gives, each with the clause that follows it.
      const clauses = text.split(/(?=\b[012]\b(?: when| on|,|;|\.|$))/);
      const said = new Set(
        clauses.map((c) => /^([012])\b/.exec(c)?.[1]).filter((c) => c !== undefined),
      );
      const real = new Set((EXIT_CODES[name] ?? []).map((line) => line.split(':')[0]));
      expect([...said].sort(), `${name}: ${text}`).toEqual([...real].sort());
    }
  });

  it('gives exit 1 to migrate and keep where the CLI does', () => {
    const bullets = exitCodeBullets();
    // migrate with managed_by: external refuses, with the file as text: exit 1.
    const migrate = bullets.get('migrate') ?? '';
    expect(migrate).toMatch(/\b1\b[^;]*managed_by: external[^;]*migrate\.external/);
    expect(
      EXIT_CODES.migrate?.some((line) => /^1:.*managed_by: external/.test(line)),
    ).toBe(true);
    // keep with managed_by: external gives the line, and exits 0.
    expect(bullets.get('keep') ?? '').toMatch(/^0 when[^;]*managed_by: external/);
    expect(EXIT_CODES.keep?.some((line) => /^0:.*managed_by: external/.test(line))).toBe(
      true,
    );
  });
});
