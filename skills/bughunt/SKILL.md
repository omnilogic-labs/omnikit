---
name: bughunt
description: >-
  Send bughunter agents into a web app, each in its own git worktree and
  browser session: each finds a bug, gets a fix planned by a deep-tier agent,
  fixes and retests it, commits, and reports. Use to bughunt, hunt for bugs,
  find and fix bugs, or dogfood a site with fixes.
---

# bughunt

Read the file for your platform and ignore the other platform files:

- Claude Code: `platforms/claude.md`
- Codex: `platforms/codex.md`
- Antigravity (agy): `platforms/agy.md`
- Any other agent: `platforms/codex.md`

Paths in your platform file are relative to this folder. When `platforms/<host>/<path>` exists,
read it instead of `<path>` (`<host>` is your platform file's name without `.md`).
