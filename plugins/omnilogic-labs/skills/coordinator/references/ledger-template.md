# Ledger

The coordinator's record of where the work stands. Only the coordinator edits it. Update it after every dispatch,
report, merge and block, so a fresh context can resume from this file alone.

**Goal:** one sentence.

**Plan:** path to the plan file.

**Current wave:** 1

## Tasks

States: planned, building, verifying, fixing (round n), passed, merged, blocked.

| Task | Depends on | State | Branch/worktree | Notes |
| ---- | ---------- | ----- | --------------- | ----- |
|      |            |       |                 |       |

Notes hold the model used, the verify result in one line (for example `PASS 3/3; look CLOSE: sky too saturated`
or `FAIL 2: check 4`), the merge commit, and anything the next wave needs.

## Running workers

One line per live worker: role, task, model, and the id or name the host gave it. Remove the line when the worker
reports. Check this list before dispatching, so no task gets two workers.

## Waves

| Wave | Tasks | Integration branch | Check | Base fast-forwarded to |
| ---- | ----- | ------------------ | ----- | ---------------------- |

## Owner

Decisions and credentials only the owner can supply, one per line, with the task each one blocks.
