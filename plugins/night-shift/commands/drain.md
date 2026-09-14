---
description: End a night-shift run cleanly. Dispatch nothing further, let every in-flight unit finish, integrate what comes back green, tear down finished worktrees, then report and stop.
disable-model-invocation: true
effort: high
---

# /drain

Finish what is running and stop. This is the ordinary way to end a session.

## Do

1. **Dispatch nothing further.** Empty the queue of anything not started. Say how many units you dropped and name them, so the user knows what was left.
2. **Let every in-flight unit finish.** Do not cancel, do not hurry, do not shorten a fix loop that is still inside its round limit. A unit that returns `BLOCKED` while draining is parked as usual.
3. **Integrate what comes back green**, one at a time, as it arrives. Draining does not suspend the one-integration-at-a-time rule.
4. **Publish according to the push policy.** A `batched` policy pushes now. A `never` policy still pushes nothing, and you say what is sitting unpushed on the base branch.
5. **Tear down worktrees for finished units** as usual, through the adapter's `teardown` hook. Leave parked units' worktrees in place; they are the only way back to that work.
6. **Reconcile tickets** for what landed.

Then report and stop.

## Closing summary

Both `/drain` and `/abort` print this same shape, so the difference between them is what happened, not how it is reported:

```
RESULT: DRAINED
LANES AT STOP: 2 were in flight, both finished
UNITS:
  #90   integrated  a1b2c3d
  #126  integrated  b2c3d4e
  #155  dropped from queue, never started
  #131  parked, needs a decision on draft visibility
INTEGRATED: #90 a1b2c3d, #126 b2c3d4e
PUSHED: none (push_policy: never); 2 commits unpushed on main
PARKED: #131 (worktree kept: /w/issue-131)
WORKTREES: removed /w/issue-90, /w/issue-126; kept /w/issue-131
NEXT: push main to deploy and close #90 and #126; #131 needs an answer on the ticket
```

## If nothing is running

Say so and exit. Report anything unpushed or any worktree still on disk, since that is the part a user cannot see at a glance.

## Do not

- Do not cancel in-flight work to finish sooner. That is `/abort`.
- Do not push outside the run's push policy just because the run is ending.
- Do not tidy parked units. Their worktrees and branches stay.
