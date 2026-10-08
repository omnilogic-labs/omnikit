---
name: primer
description: >-
  Turn a vague product idea into a primer.md build-brief, decompose it into idempotent task files under docs/init/, and run the primer build. Use for fuzzy concepts, "make a primer", "bootstrap a project from this idea", "decompose into tasks", "run the primer build".
---

# primer

Read the file for your platform and ignore the other platform files:

- Claude Code: `platforms/claude.md`
- Codex: `platforms/codex.md`
- Antigravity (agy): `platforms/agy.md`
- Any other agent: `platforms/codex.md`

Paths in your platform file are relative to this folder. When `platforms/<host>/<path>` exists,
read it instead of `<path>` (`<host>` is your platform file's name without `.md`).
