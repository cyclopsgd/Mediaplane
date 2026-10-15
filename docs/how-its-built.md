# How Mediaplane is built

Mediaplane is written by AI coding agents (Claude Code), working under a maintainer who
sets the direction and makes the product decisions. Every commit an agent writes says
so in a `Co-Authored-By` line.

Agents can write a lot of code quickly. They can also be confidently wrong about how an
app behaves, write tests that are kinder than the real thing, or leak a value into a log
without noticing. So most of the process is checking, and each stage is set up to catch
a different kind of mistake.

This page explains that process. It follows the Superpowers plugin's
[writing-plans](https://github.com/obra/superpowers) and subagent-driven-development
skills, with some rules of the project's own.

## The documents it works from

- **The design**, [`docs/design/m1-engine-cli.md`](design/m1-engine-cli.md), says what
  M1 does. It is binding: when a plan and the design disagree, the design wins.
- **The roadmap**, [`docs/plans/m1-roadmap.md`](plans/m1-roadmap.md), splits M1 into
  slices. Each slice ends with something that works and can be tested. Its "Inputs for
  later slices" list carries forward everything a review found but put off.
- **One plan per slice**, in [`docs/plans/`](plans/), says exactly how the slice is
  built, task by task.
- **The ADRs**, in [`docs/adr/`](adr/), record the larger decisions and why they were
  made.

## A slice, start to finish

```text
design + roadmap
       |
       v
plan: probe, build, replay
       |
       v
conflict check, decisions
       |
       v
each task:
  build -> review -> fix
       |
       v
final review, one round of fixes
       |
       v
CI on amd64 and arm64
       |
       v
merge to main
```

### 1. The plan

One agent, on the most capable model, writes the plan. It doesn't write it from
memory. It builds the slice once for real:

- **Probes first.** It starts the real, pinned images of the apps the slice touches and
  checks how they actually answer: what a wrong password returns, whether an API shows
  a key in full or masked, and what a setting looks like when read back. Each result is
  written into the plan's Decisions. The test fakes must answer the same way.
- **Every task is built.** It writes each task's tests and code on a scratch copy of the
  repo, one commit per task. Tests come first, and the plan states how each should fail
  before the code exists.
- **The plan holds exact code.** Each task's code in the plan is the exact diff from
  those commits, so the agents who build it later copy it instead of designing it again.
- **The replay.** It then applies the plan from scratch, exactly as written. It runs
  every check after each task, then the full end-to-end suite against real Docker. It
  runs that suite twice: on the Docker Compose version CI uses, and on a newer one. If
  anything in the plan is wrong, it fixes the plan and replays it.

This is the slowest stage, often about half of a slice, because it amounts to building
the slice twice. It is also where most mistakes are cheapest to find.

### 2. The conflict check

Before any task starts, a second agent reads the whole plan looking for tasks that
contradict each other, the design, or the project's rules. The lead agent, which
coordinates the slice and writes none of its code, decides what to do about each finding,
and the plan is corrected and replayed.

### 3. The tasks

The lead agent never writes the slice's code itself. For each task:

1. **Build.** A fresh agent gets only that task's text and the names it needs from
   earlier tasks, not the whole history. It applies the task, runs the tests and
   commits.
2. **Review.** A different agent reviews the task's diff against the task's
   requirements, and separately for quality. It sees the diff, the task's text and the
   builder's report.
3. **Fix.** If the review finds problems, the lead agent decides what must change and
   why, the builder fixes it, and a reviewer checks just the fix.

A task is done only when its review passes. The lead agent keeps a written log of
every task, decision and commit, so the work can resume exactly where it was.

### 4. The final review

When every task is done, an agent on the most capable model reviews the whole branch at
once. This catches what single tasks can't show: a pattern repeated across files,
docs that no longer match the code, or a gap between tasks. Its findings are fixed in
one round and checked again. Anything that should wait goes on the roadmap's list for a
later slice, with the reason.

### 5. CI and the merge

The branch goes up as a pull request. CI runs the checks, and runs the real-Docker
end-to-end tests and the image scan on both amd64 and arm64. When it is green, the
branch is merged to `main` as a fast-forward, so the reviewed commits are exactly the
ones on `main`.

## What the maintainer decides

The agents work through the slices on their own, but they stop and ask for:

- product trade-offs, such as what Mediaplane should do when a user changes a setting it
  manages;
- anything security-sensitive, such as a new Docker permission for Mediaplane's socket
  proxy;
- anything that can't be undone, or that reaches outside the repo;
- steps only a person can do, such as signing in to an outside account.

The lead agent records the smaller calls it makes, with its reasons, in each plan's
Decisions and in the log.

## Rules every agent follows

- **The repo is public.** Every key, password and token in it is fake.
- **Secrets never reach output.** Not in errors, logs, change records or test failure
  messages, because CI logs are public too.
- **Claims are checked against the real app.** A fake in a test must behave like the
  real app, and the docs mustn't say what was never seen.
- **No shortcuts on security.** Mediaplane's Docker access stays limited to the calls
  it needs.
- **History is never rewritten** once it has been pushed.

## What the checking catches

Some of what the reviews found in Slice 4 (indexers), all fixed before the merge:

- two places where a failing test could have printed an app's whole reply into the
  public CI log, one of them including Sonarr's API key;
- test fakes that accepted requests the real apps refuse;
- docs that said `plan` changes nothing, without the exceptions it had at the time;
- a claim about how often an app tests a setting that no probe had checked.

## Where to see it

- Each slice's plan is in [`docs/plans/`](plans/), with its probes and Decisions.
- Each slice's pull request lists what changed and what the reviews found.
- The commit history shows each task's commit and its fix commits.
