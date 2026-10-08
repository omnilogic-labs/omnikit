---
name: agent-browser
description: Drives a real Chrome browser through the agent-browser CLI using accessibility snapshots and refs. Use to open sites, fill forms, click, screenshot, scrape, test web apps, run a11y audits, or log in. Delegate multi-step browsing to a browser-buddy subagent if one exists.
---

# agent-browser

Read the file for your platform and ignore the other platform files:

- Claude Code: `platforms/claude.md`
- Codex: `platforms/codex.md`
- Antigravity (agy): `platforms/agy.md`
- Any other agent: `platforms/codex.md`

Paths in your platform file are relative to this folder. When `platforms/<host>/<path>` exists,
read it instead of `<path>` (`<host>` is your platform file's name without `.md`).
