---
name: render
description: >-
  Operate Render.com services: write render.yaml blueprints, SSH into running services, call the Render REST API, and explain Render hosting. Use for "deploy to render", "render.yaml", "ssh into render", "render logs", "render api", "srv-... host", "run a migration on render".
---

# render

Read the file for your platform and ignore the other platform files:

- Claude Code: `platforms/claude.md`
- Codex: `platforms/codex.md`
- Antigravity (agy): `platforms/agy.md`
- Any other agent: `platforms/codex.md`

Paths in your platform file are relative to this folder. When `platforms/<host>/<path>` exists,
read it instead of `<path>` (`<host>` is your platform file's name without `.md`).
