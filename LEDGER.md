# Ledger

The coordinator's record of where the work stands. Only the coordinator edits it. Update it after every dispatch,
report, merge and block, so a fresh context can resume from this file alone.

**Goal:** Close the four compile-step review follow-ups (agy model validation, build OS default, leftover dashes, agy agents by name).

**Plan:** plan/followups.md

**Current wave:** 1

## Tasks

States: planned, building, verifying, fixing (round n), passed, merged, blocked.

| Task               | Depends on | State    | Branch/worktree         | Notes                                           |
| ------------------ | ---------- | -------- | ----------------------- | ----------------------------------------------- |
| agy-model-check    | none       | building | wave/agy-model-check    | sonnet; wave 1                                  |
| dash-cleanup       | none       | building | wave/dash-cleanup       | sonnet; wave 1                                  |
| agy-agents-by-name | none       | building | wave/agy-agents-by-name | opus; wave 1; coordinator SKILL.md at 150 lines |
| build-os-default   | wave 1     | planned  |                         | opus; wave 2; then install.sh + verify on main  |

Notes hold the model used, the verify result in one line (for example `PASS 3/3` or `FAIL 2: criterion 4`), the
merge commit, and anything the next wave needs.

## Running workers

One line per live worker: role, task, model, and the id or name the host gave it. Remove the line when the worker
reports. Check this list before dispatching, so no task gets two workers.

- builder, agy-model-check, sonnet
- builder, dash-cleanup, sonnet
- builder, agy-agents-by-name, opus

## Waves

| Wave | Tasks | Integration branch | Check | Base fast-forwarded to |
| ---- | ----- | ------------------ | ----- | ---------------------- |

## Owner

Decisions and credentials only the owner can supply, one per line, with the task each one blocks.

- Defaulted: if agy print mode cannot run a subagent, document invoke_subagent from the schema agy reports and keep the paste fallback (agy-agents-by-name).
