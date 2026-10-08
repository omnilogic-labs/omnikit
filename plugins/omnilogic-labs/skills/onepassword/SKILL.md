---
name: onepassword
description: Read secrets (API keys, SSH keys, tokens, passwords) from 1Password via the op CLI without leaking them; handles WSL op.exe. Use for "get X from 1password", "op read", "fetch my API key", "pull the SSH key", signing in to op, caching a key to a file, or OP_SERVICE_ACCOUNT_TOKEN.
---

# onepassword

Reads secrets from 1Password and hands them to whatever needs them (an SSH key in a file, a token in the environment) as clean values that never reach the transcript. Skip this skill if the secret is already in an environment variable or another password manager.

## Rules

1. Use the helper `bin/op-secret` (path relative to this SKILL.md's directory). Do not hand-roll `op` or `op.exe` calls. The helper resolves the binary, reveals concealed fields, strips `\r` and wrapping quotes, writes mode 600, and caches. It is a bash script: on Windows run it from Git Bash, or from PowerShell as `& "$env:ProgramFiles\Git\bin\bash.exe" <skill dir>/bin/op-secret ...`, never bare (Windows opens an "Open with" dialog and hangs).
2. `command -v op` returning nothing does not mean 1Password is unavailable. On WSL the CLI is `op.exe`, and the helper finds it.
3. "account is not signed in" means the desktop app's CLI integration is off or the app is locked. Ask the user to enable Settings, Developer, Integrate with 1Password CLI and unlock the app; the first read then shows a one-time desktop approval. Then retry.
4. Item titles with spaces and parens are fine: `bin/op-secret --item "render api key (claude)" --field notesPlain --out FILE`.
5. Never print a secret. No `cat` of a key file, no `echo "$TOKEN"`. Verify with `head -1 file`, `wc -c file`, or `ssh-keygen -y -f file`.

## Calling the helper

The helper is plain bash; its only dependency is the 1Password CLI. Name a secret in one of two ways:

```bash
# Secret reference (preferred): op://<vault>/<item>/<field>
bin/op-secret "op://Personal/Stripe/api key"

# Item + field
bin/op-secret --item "Stripe" --field "api key" --vault Personal
```

Both print the cleaned value to stdout. Add `--out FILE` to write it to a file with mode 600 instead, or `--cache FILE` to reuse a previously fetched file and contact 1Password (and its unlock prompt) only when the cache is empty.

```bash
# SSH private key to a file, ready for ssh -i:
bin/op-secret --item "deploy key" --field "private key" --out ~/.ssh/deploy_ed25519

# API token into the environment, never on disk:
export STRIPE_KEY="$(bin/op-secret 'op://Personal/Stripe/api key')"

# Fetch once, reuse later:
bin/op-secret --item "deploy key" --field "private key" --cache ~/.ssh/deploy_ed25519
```

List what exists with `op vault list`, `op item list`, and `op item get "<title>" --format json` (exact field labels for `--field`).

## Handling secrets safely

- Prefer files (`--out`) or a captured variable over inline arguments; a secret on a command line shows in the process list.
- Delete short-lived cache files after the task.
- `op run` and `op inject` resolve `op://` references at run time and keep secrets off disk. See `references/usage.md`.

## Authentication

- Interactive: with the desktop app and CLI integration enabled, `op` unlocks through the app (Touch ID, Windows Hello, or app password). Under WSL, `op.exe` uses the Windows app. The first call in a session may prompt on the desktop.
- Headless (CI): set `OP_SERVICE_ACCOUNT_TOKEN`; `op` then runs without the desktop app, scoped to the vaults that token can read.
- If a command reports not signed in, run `op signin` (or `eval "$(op signin)"`) and retry.

## References

- `references/auth.md`: sign-in, desktop integration, service accounts, WSL and op.exe.
- `references/usage.md`: secret references, `op read`, `op item get`, `op run`, `op inject`, env files, listing vaults and items.
- `references/troubleshooting.md`: symptom-to-cause table covering masked values (concealed fields need `--reveal`), `op` vs `op.exe`, `\r` bytes and wrapping quotes that invalidate SSH keys, file permissions, not signed in, and checks that do not leak.
