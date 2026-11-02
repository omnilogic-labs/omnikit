---
max_turns: 10
allowed_tools: [Read, Glob, Grep, Skill]
---

Use the coordinator skill. You are a fresh coordinator context resuming a run with 64 open task issues, each with a long plan body and a thread of builder and verifier reports. `scripts/ledger status` printed:

```text
Run #2: Build the editor redesign
Now:
  Wave G53 verifying. The owner asked this morning about test speed; some task discusses shards.
Wave now: G53
verifying: rd-home-live #47
fixing: test-speed-split #30 (round 2)
ready: rd-theme-live #38, sm-page #70
merged: 7, dropped: 0, open: 64
```

`scripts/ledger index` shows `(stale)` for 40 of the tasks. Say, in order, which commands you run to learn what the round-2 failure on test-speed-split was, to find the task that discusses shards, and to brief the next builder for rd-theme-live. Do not dispatch anything and do not run anything.
