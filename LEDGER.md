# Ledger

The coordinator's record of where the work stands. Only the coordinator edits it. Update it after every dispatch,
report, merge and block, so a fresh context can resume from this file alone.

**Goal:** Add an in-repo bun compile step that renders skills and agent files per host (Claude Code, Codex, agy) from one templated source.

**Plan:** plan/compile-step.md (untracked in main checkout; pass absolute path)

**Current wave:** 5 (waves 1-4 merged to main; real install.sh run; verify 17/17)

## Tasks

States: planned, building, verifying, fixing (round n), passed, merged, blocked.

| Task            | Depends on                | State                                                                        | Branch/worktree     | Notes                                                                                                                                                                                                       |
| --------------- | ------------------------- | ---------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| host-facts      | none                      | verifying                                                                    | wave/host-facts     | sonnet; built e215fcc; Codex TOML agents load (spawn_agent agent_type); unknown keys ok on both; link Codex skills into one dir only; agy invalid model = agent vanishes; codex exec/agy -p need </dev/null |
| compiler        | none                      | passed                                                                       | wave/compiler       | opus; PASS 6/6 (verify link checks only meaningful on main); check+exec bits not compared by --check                                                                                                        |
| migrate-sources | compiler                  | planned                                                                      |                     | sonnet; wave 2                                                                                                                                                                                              |
| os-axis         | compiler                  | planned                                                                      |                     | opus; wave 2; owns scripts/build/os.ts + render changes                                                                                                                                                     |
| portable-tree   | migrate-sources           | planned                                                                      |                     | opus; wave 3                                                                                                                                                                                                |
| install-verify  | portable-tree, host-facts | passed (crit 6 + Claude verify lines deferred to main after real install.sh) | wave/install-verify | opus; built 44b2e26                                                                                                                                                                                         |
| host-prose      | portable-tree             | merged                                                                       | -                   |                                                                                                                                                                                                             |
| docs            | wave 4                    | planned                                                                      |                     | sonnet; wave 5; after wave 4 lands, run bash install.sh on main                                                                                                                                             |

Notes hold the model used, the verify result in one line (for example `PASS 3/3` or `FAIL 2: criterion 4`), the
merge commit, and anything the next wave needs.

## Running workers

One line per live worker: role, task, model, and the id or name the host gave it. Remove the line when the worker
reports. Check this list before dispatching, so no task gets two workers.

- builder, docs, sonnet
- planner, amend plan for portable root skills/, opus

## Waves

| Wave | Tasks | Integration branch | Check | Base fast-forwarded to |
| ---- | ----- | ------------------ | ----- | ---------------------- |

## Owner

- DECIDED: commit plan and ledger while working; when done, git rm plans and reset LEDGER.md to the empty template. Goes into host-prose (Finishing section).

Decisions and credentials only the owner can supply, one per line, with the task each one blocks.

- DECIDED: root skills/ (npx skills) = portable dispatcher SKILL.md pointing at per-platform files. Plan amended: portable-tree (wave 3), os-axis (wave 2). No open owner questions.

Check command: `bun run check && bun run verify`. Base: main. Push: never (owner commits/pushes).
