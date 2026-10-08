---
name: onepassword
description: >-
  Retrieve secrets (API keys, SSH private keys, tokens, passwords, connection
  strings) from 1Password via the op CLI, reliably and without leaking them.
  Use when the user wants to read a secret from 1Password, fetch an API key or
  SSH key from their vault, sign in to op, cache a key to a file, or inject
  secrets into a command or env file. Triggers include "get X from 1password",
  "read a secret", "op cli", "fetch my API key", "pull the SSH key from my
  vault", "op read", "OP_SERVICE_ACCOUNT_TOKEN". Works under WSL, where the CLI
  is op.exe (a bare `command -v op` may be empty); always use the helper rather
  than hand-rolling op commands.
---

# onepassword

## Do this first (read before touching op)

1. **Use `bin/op-secret`. Do not hand-roll `op`/`op.exe` calls.** The helper
   already resolves the binary, reveals concealed fields, strips `\r` and
   wrapping quotes, writes mode 600, and caches. Hand-rolling these is how this
   goes wrong.
2. **`command -v op` returning nothing does NOT mean 1Password is unavailable.**
   On WSL the CLI is `op.exe` (the Windows app's binary). The helper finds it.
   Never conclude "no 1Password" from a missing native `op`.
3. **"account is not signed in" is not a dead end.** It means the desktop app's
   CLI integration is off or the app is locked. Ask the user to enable
   **Settings, Developer, Integrate with 1Password CLI** and unlock the app; the
   first read then pops a one-time desktop approval they accept. Then retry.
4. **Read an item by title is fine**, spaces and parens included:
   `bin/op-secret --item "render api key (claude)" --field notesPlain --out FILE`.

Read secrets from 1Password through its command line tool (`op`) and hand them
to whatever needs them: an SSH key written to a file, an API token exported into
the environment, a password piped into a command. The hard part is not the
lookup; it is getting a _clean, usable_ value out without corrupting it or
leaking it into the transcript. This skill ships a helper, `bin/op-secret`, that
handles the sharp edges.

This skill is about 1Password only. It does not assume what the secret is for.
A caller that has a secret in an environment variable or a different password
manager does not need this skill at all.

## Calling the helper

The Skill loader prints `Base directory for this skill: <path>` when launching.
Call the helper relative to that base directory:

```bash
OPS="<base-dir>/bin/op-secret"
"$OPS" "op://Personal/GitHub/token"
```

Or `cd <base-dir>` once and call `bin/op-secret`. The helper is plain bash; its
only dependency is the 1Password CLI.

## The two ways to name a secret

1. **Secret reference** (preferred when you know the path): `op://<vault>/<item>/<field>`.

   ```bash
   "$OPS" "op://Personal/Stripe/api key"
   ```

2. **Item + field** (when the title is easier than the path):

   ```bash
   "$OPS" --item "Stripe" --field "api key" --vault Personal
   ```

Both print the cleaned value to stdout. Add `--out FILE` to write it to a file
with mode `600` instead, or `--cache FILE` to reuse a previously fetched file
and only hit 1Password (and its unlock prompt) when the cache is empty.

```bash
# Write an SSH private key to a file, ready for ssh -i:
"$OPS" --item "deploy key" --field "private key" --out ~/.ssh/deploy_ed25519

# Export an API token into the environment without it touching disk:
export STRIPE_KEY="$("$OPS" 'op://Personal/Stripe/api key')"

# Fetch once, then reuse from cache on later runs:
"$OPS" --item "deploy key" --field "private key" --cache ~/.ssh/deploy_ed25519
```

Discover what is available with `op vault list` and `op item list`, or
`op item get "<title>"` to see an item's fields (`op item get "<title>" --format json`
for the exact field labels to pass to `--field`).

## Why the helper exists: reliability gotchas

These are the things that make raw `op` calls fail in practice. The helper
handles all of them; read this so you understand what it is doing and can debug
when something is off.

- **`op` vs `op.exe`.** Under WSL there is often no native `op`; the 1Password
  CLI is the Windows binary, surfaced as `op.exe`. The helper prefers `op` and
  falls back to `op.exe`. If you call `op` directly and get "command not found,"
  try `op.exe`.
- **Concealed fields need `--reveal`.** `op item get <item> --fields <field>`
  returns a masked reference unless you pass `--reveal`. Without it you get
  something unusable, not the secret. (`op read op://...` reveals by default.)
- **Carriage returns.** `op.exe` emits Windows line endings (`\r\n`). A private
  key with stray `\r` bytes is invalid and SSH rejects it. The helper strips
  them (`tr -d '\r'`).
- **Wrapping quotes.** `--reveal` on a multiline value (an SSH key) wraps the
  output in a literal `"` on the first and last lines. Those must be removed or
  the key file is malformed. The helper drops the lone leading and trailing
  quote lines.
- **File permissions.** Private keys must be mode `600` or SSH refuses them.
  `--out` and `--cache` always `chmod 600`.

See `references/troubleshooting.md` for the symptom-to-cause table.

## Authentication

`op` needs an authenticated session before it can read anything.

- **Interactive (desktop app).** With the 1Password desktop app installed and
  CLI integration enabled, `op` unlocks through the app (Touch ID, Windows
  Hello, or the app password). Under WSL, `op.exe` uses the Windows desktop app
  the same way. The first `op-secret` call in a session may trigger an unlock
  prompt on the desktop; that is expected.
- **Headless (service account).** For CI or non-interactive use, set
  `OP_SERVICE_ACCOUNT_TOKEN` in the environment. `op` then runs without the
  desktop app, scoped to the vaults that token can read.
- **`op signin`.** If a command reports you are not signed in, run `op signin`
  (or `eval "$(op signin)"`) and retry.

Details and the WSL specifics are in `references/auth.md`.

## Handling secrets safely

- **Never echo a secret into the transcript.** Do not `cat` a key file or
  `echo "$TOKEN"`. Write keys to files (`--out`) or capture into a variable;
  verify with non-revealing checks (`head -1 file` shows only the key header,
  `wc -c file`, `ssh-keygen -y -f file` to confirm a key parses).
- **Prefer environment or files over inline arguments.** A secret on a command
  line is visible in the process list. Use `--out` for keys and capture into an
  env var for tokens.
- **Delete short-lived caches.** If you fetched a key only for one task, remove
  the cache file afterward.
- **`op run` and `op inject`** keep secrets out of disk entirely by resolving
  `op://` references at run time. See `references/usage.md`.

## What lives where

- `bin/op-secret`: the helper. Resolves the binary, reveals, cleans, and writes.
- `references/auth.md`: sign-in, desktop integration, service accounts, WSL/op.exe.
- `references/usage.md`: secret references, `op read`, `op item get`, `op run`,
  `op inject`, env files, listing vaults and items.
- `references/troubleshooting.md`: symptom-to-cause table (references instead of
  values, invalid keys, permission errors, not signed in).
