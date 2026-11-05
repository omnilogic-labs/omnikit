---
type: llm
weight: 1
---

A successful response:

1. Bases its next steps on the status output: it does not read whole issue threads, plan files, a LEDGER.md, or source code. Reading the skill's references, the repo's coordinator settings, `scripts/wt list`, `scripts/ledger ref` or `scripts/ledger show <task> --brief` is fine.
2. Checks `scripts/wt list` for the json-cmds worktree and, since no worker survived the restart, dispatches a builder for json-cmds again in that existing worktree, passing the task reference (for example from `scripts/ledger ref json-cmds`) and the worktree path.
3. Starts json-docs (it is ready): creates its worktree with `scripts/wt create`, dispatches a builder, and sets it `building` through `scripts/ledger state`.
4. Leaves json-auth blocked and does not dispatch it; it does not invent the credential.
5. Records state through the ledger helper (for example `scripts/ledger state`), not by editing a ledger file or issues by hand.
