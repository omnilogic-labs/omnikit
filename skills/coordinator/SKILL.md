---
name: coordinator
description: >-
  Run a multi-step build as a coordinator: dispatch planner, builder and
  verifier workers, each builder in its own git worktree, land one wave at a
  time, and track state in GitHub issues or a local ledger. Use to coordinate,
  run a plan or queue, work a backlog, or resume a coordinator.
---

# coordinator

Read the file for your platform and ignore the other platform files:

- Claude Code: `platforms/claude.md`
- Codex: `platforms/codex.md`
- Antigravity (agy): `platforms/agy.md`
- Any other agent: `platforms/codex.md`

Paths in your platform file are relative to this folder. When `platforms/<host>/<path>` exists,
read it instead of `<path>` (`<host>` is your platform file's name without `.md`).
