---
name: plain-writing
description: >-
  Rules and a revision pass for prose a reader understands first time:
  docs, findings, status updates, summaries, decision records, commit messages,
  PR text. Use when writing for another reader, or when asked to write
  plainly, "make this clearer", "too verbose", "less jargon", "write this up".
---

# plain-writing

Read the file for your platform and ignore the other platform files:

- Claude Code: `platforms/claude.md`
- Codex: `platforms/codex.md`
- Antigravity (agy): `platforms/agy.md`
- Any other agent: `platforms/codex.md`

Paths in your platform file are relative to this folder. When `platforms/<host>/<path>` exists,
read it instead of `<path>` (`<host>` is your platform file's name without `.md`).
