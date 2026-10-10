---
name: questionnaire
description: Build a decision questionnaire page from JSON: per-question background, what happened, images, options with consequences, and an "I don't know" default, plus a paste-back answer block. Use whenever the owner must decide something, instead of asking in chat.
---

# questionnaire

Read the file for your platform and ignore the other platform files:

- Claude Code: `platforms/claude.md`
- Codex: `platforms/codex.md`
- Antigravity (agy): `platforms/agy.md`
- Any other agent: `platforms/codex.md`

Paths in your platform file are relative to this folder. When `platforms/<host>/<path>` exists,
read it instead of `<path>` (`<host>` is your platform file's name without `.md`).
