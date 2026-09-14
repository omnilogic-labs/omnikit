---
description: Stop a night-shift run now. Cancel in-flight agents, leave every worktree and branch untouched, and report exactly what was cancelled and where each one's work sits.
disable-model-invocation: true
effort: high
---

# /abort

Stop now. The point of this command is to freeze the scene, not to tidy it.

## Do

1. **Cancel in-flight agents.** Stop each running task by id (`TaskStop`), and name every one you stopped.
2. **Leave their worktrees and branches exactly as they are.** No teardown, no data store drop, no branch deletion, no stash, no cleanup of any kind.
3. **Integrate nothing.** A unit that had already returned green but has not been integrated stays unintegrated, and you say so.
4. **Push nothing**, whatever the push policy says.
5. **Report where each cancelled unit's work sits**: branch, last commit, worktree path, and how far it had got (planning, implementing, verifier round 2, awaiting integration). That report is the only record of the run, so it has to be precise enough to resume from.

Then stop.

## Closing summary

Both `/abort` and `/drain` print this same shape, so the difference between them is what happened, not how it is reported:

```
RESULT: ABORTED
LANES AT STOP: 2 in flight, both cancelled
UNITS:
  #90   cancelled during verifier round 2; branch issue-90-auth-cookie at c3d4e5f in /w/issue-90
  #126  cancelled during implementation; branch issue-126-preview at 4d5e6f7 in /w/issue-126, uncommitted changes present
  #133  returned green, NOT integrated; branch issue-133-flags at 7a8b9c0
  #155  never started
INTEGRATED: none
PUSHED: none
PARKED: #131 (unchanged by this abort)
WORKTREES: all kept, nothing removed
NEXT: nothing is lost; resume by re-running /orchestrate, or inspect each branch directly
```

Say explicitly when a worktree has uncommitted changes. That is the state most easily destroyed by the next thing someone runs.

## If nothing is running

Say so and exit. Report any worktree still on disk and anything green but unintegrated, because an abort with nothing running still owes the user an accurate picture.

## Do not

- Do not remove a worktree, drop a data store, or delete a branch. Not even one you provisioned this run.
- Do not integrate a unit that had just returned green. It waits.
- Do not commit on an agent's behalf to make its state cleaner.
- Do not wait for anything to finish. That is `/drain`.
