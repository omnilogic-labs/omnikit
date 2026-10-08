---
name: onepassword
description: Read secrets (API keys, SSH keys, tokens, passwords) from 1Password via the op CLI without leaking them; handles WSL op.exe. Use for "get X from 1password", "op read", "fetch my API key", "pull the SSH key", signing in to op, caching a key to a file, or OP_SERVICE_ACCOUNT_TOKEN.
---

# onepassword

Read the file for your platform and ignore the other platform files:

- Claude Code: `platforms/claude.md`
- Codex: `platforms/codex.md`
- Antigravity (agy): `platforms/agy.md`
- Any other agent: `platforms/codex.md`

Paths in your platform file are relative to this folder. When `platforms/<host>/<path>` exists,
read it instead of `<path>` (`<host>` is your platform file's name without `.md`).
