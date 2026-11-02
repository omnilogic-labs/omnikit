---
type: llm
weight: 1
---

A successful response:

1. Never reads the 40 stale tasks itself. If it uses the index, it refreshes it through a reader subagent on the lightest or fast model (`ledger index --stale`, then `--save`).
2. Learns the round-2 failure from a lean read of that one task (for example `ledger comments test-speed-split --heads`, `ledger show test-speed-split --brief` or `ledger show test-speed-split`), not from `gh issue view` on the thread, `gh api` without `--jq`, or opening every comment in full.
3. Finds the shards task with `ledger grep shard` (or an equivalent single search), not by opening tasks one by one.
4. Briefs the rd-theme-live builder with the task reference (from `ledger ref`) and a worktree path only: it does not read or paste the task's plan text into the brief.
