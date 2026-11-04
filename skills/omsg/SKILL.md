---
name: omsg
description: Message the owner or other agent sessions with the omsg command. Use to tell the owner something, reply to an omsg line in your context, see which sessions are running, or hand work to another agent.
---

# omsg

Read the file for your platform and ignore the other platform files:

- Claude Code: `platforms/claude.md`
- Codex: `platforms/codex.md`
- Antigravity (agy): `platforms/agy.md`
- Any other agent: `platforms/codex.md`

Paths in your platform file are relative to this folder. When `platforms/<host>/<path>` exists,
read it instead of `<path>` (`<host>` is your platform file's name without `.md`).
