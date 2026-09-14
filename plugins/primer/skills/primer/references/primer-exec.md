# primer-exec: the vendored task runner

`primer-exec` is a single TypeScript file shipped with this skill at
`bin/primer-exec.ts`. It is the standalone, sequential, dependency-ordered task
runner. It replaces the per-project `run-tasks.ts` / `run-tasks.sh` scripts that
used to be hand-written into each repo (and that accumulated the bugs listed at
the bottom of this file). The name is deliberately distinct so it never clobbers
an existing `run-tasks` script in a target repo.

Use `primer-exec` for a strictly sequential build, or when the Workflow tool is
not available. Use the dynamic Workflow (`references/build-workflow.md`) when you
want independent task groups to run in parallel.

## Running it

Run from the **target repo root** (cwd must be the project being built). It runs
under either `tsx` or `bun` and needs no install:

```bash
# from the project being built
npx tsx <skill-base-dir>/bin/primer-exec.ts --list
bun <skill-base-dir>/bin/primer-exec.ts            # equivalent

# optional: put it on PATH for convenience
ln -sf <skill-base-dir>/bin/primer-exec.ts ~/.local/bin/primer-exec
primer-exec --list
```

`<skill-base-dir>` is the directory the Skill loader prints when the skill loads
(the `primer` skill folder).

## Options

```
--task-dir <dir>     task directory (default: docs/init)
--from <NN>          start at task number NN (inclusive)
--only <NN>          run only task NN (implies --force for that task)
--list               list tasks with completion and dependency state, then exit
--dry-run            show what would run without spawning anything
--force              re-run tasks even if their marker exists
--resume             checkpoint a dirty tree and surface recent commits to the agent
--idle-timeout <s>   idle watchdog seconds, 0 disables (default: 600)
--model <name>       claude model (default: opus)
--effort <level>     claude effort (default: max)
--api-billing        use ANTHROPIC_API_KEY billing instead of the subscription default
```

## What it does per task

1. Spawn `claude -p` with the task body plus a generic preamble (read CLAUDE.md
   and docs/init.md, do the task, commit your own work, do not mint the marker,
   use context7 for versions, no foreground servers). Prompt is piped on stdin.
2. Stream the JSON output to `logs/run-tasks/<slug>.jsonl`, watching an idle
   timer and a post-result teardown timer.
3. After the child exits cleanly, run four gates in order, fail-fast: clean tree,
   build (auto-detected), the task's acceptance command, typecheck (auto-detected).
4. Require at least one changed file (unless the task sets `allow-empty: true`),
   then mint an empty `[task-complete] NN-slug` marker commit.

Idempotency is durable: re-running skips any task whose marker exists on HEAD.
`--force` or `--only` re-runs anyway. Missing dependencies always block, even
under `--force`.

## Output contract

- Human-readable progress goes to **stderr**.
- Machine-readable state events go to **stdout**, one JSON object per line:
  `task_start`, `task_done`, `task_fail`, `gate_fail`, `task_blocked`,
  `task_dryrun`, `task_interrupted`, `run_done`. A wrapping workflow or CI job
  can parse stdout without the human chatter interfering.
- Full child JSONL and stderr are teed to `logs/run-tasks/`.

## Build / typecheck auto-detection

Package manager is detected by lockfile (`bun.lock*` then `pnpm-lock.yaml` then
`yarn.lock` then npm). Build runs `<pm> run build` if `package.json` has a
`build` script, else it is skipped with a note. Typecheck runs `tsc --noEmit`
(through the detected pm) if `tsconfig.json` exists, else it is skipped. The
acceptance command always runs whatever the task declares, verbatim.

## Bugs this runner deliberately fixes

These came from comparing every `run-tasks` variant across the user's projects.
Do not reintroduce them when editing:

- **Watchdog "mystery hangs."** The old idle watchdog only disabled itself on a
  _success_ result, raced its kill against a separate post-result killer, and
  guarded escalation with `child.killed` (which reflects signal delivery, not
  death). One fork deleted hang-detection entirely rather than fix it. The
  rewrite uses a single idle timer disabled on the **first result event of any
  subtype**, an explicit post-result SIGTERM then SIGKILL escalation, and an
  `exited` flag for every guard.
- **Trailing-line double-write.** The old runner opened a _second_ write stream
  to the same log file to flush the final partial line, racing the first
  stream's close. The rewrite uses `readline`, which handles partial lines and
  the final flush correctly with one stream.
- **Ctrl-C did not stop the run.** Some runners had no `interrupted` flag, so the
  child swallowed SIGINT, exited 0, and the loop advanced to the next task. Here
  `interrupted` dominates at exit (exit 130) and a second Ctrl-C force-kills.
- **Vacuous acceptance passes.** The old gate ran the acceptance block only if it
  matched a command whitelist; `pnpm`, `bun`, `cargo`, `pytest`, `make`, and
  others were not whitelisted, so their acceptance silently no-opped and the gate
  passed green. Here acceptance comes from frontmatter and runs verbatim.
- **False completions.** One runner minted a marker on `result.success` even with
  zero file changes, poisoning idempotency forever. Here a zero-changes task
  fails unless it opts in with `allow-empty: true`.
- **`git add -A` attribution.** Some runners committed the whole dirty tree
  themselves, sweeping unrelated files into the marker. Here the subagent commits
  its own work; the runner only mints an empty marker and fails a dirty tree.
- **Sort breaks past 99 tasks.** Lexical sort and a `\d{2}` anchor mis-ordered or
  dropped task 100+. Here tasks are sorted numerically and `\d{2,}` is matched.
- **`--from` zero-padding.** `--from 6` used to skip `06-...`. Here NN is compared
  numerically.
- **Shell-string git calls.** Marker interpolation into `execSync` strings was
  injection-fragile. Here every git call uses an argument array.
- **`git log | grep -q` SIGPIPE.** The shell runners' boolean idempotency check
  died on SIGPIPE under `pipefail`, giving false results. This runner reads git
  output in process and matches in TypeScript.
- **No dependency awareness.** Every old runner ordered purely by filename. This
  one topologically sorts declared `deps` and blocks a task whose deps are not
  complete.
