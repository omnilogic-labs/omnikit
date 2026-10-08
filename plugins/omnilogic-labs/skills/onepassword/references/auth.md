# Authentication

`op` cannot read anything until there is an authenticated session. There are two
models.

## Interactive (1Password desktop app)

This is the default on a workstation.

1. Install the 1Password desktop app and sign in to your account there.
2. Enable CLI integration: app **Settings, Developer, Integrate with 1Password CLI**.
3. From then on, `op` unlocks through the app. The first command in a session
   pops a biometric or password prompt (Touch ID on macOS, Windows Hello, or the
   app password). After that the session stays unlocked for a while.

Check the session:

```bash
op whoami        # prints the signed-in account, or errors if not signed in
op account list  # lists configured accounts
```

If a command says you are not signed in:

```bash
eval "$(op signin)"          # default account
eval "$(op signin --account my.1password.com)"
```

## WSL: op.exe and the Windows app

On WSL there is usually no native Linux `op`. Instead the Windows 1Password CLI
is reachable from the Linux shell as `op.exe`, and it talks to the Windows
desktop app for unlock. The `op-secret` helper detects this automatically
(native `op` first, then `op.exe`).

Things to know under WSL:

- The unlock prompt appears on the Windows desktop, not in the terminal.
- `op.exe` emits Windows line endings (`\r\n`); the helper strips them. If you
  call `op.exe` directly, pipe through `tr -d '\r'`.
- Enable **Settings, Developer, Integrate with 1Password CLI** in the Windows
  app, or `op.exe` will not be authorized.

## Headless (service account)

For CI, containers, or any non-interactive run, use a service account token
instead of the desktop app:

```bash
export OP_SERVICE_ACCOUNT_TOKEN="ops_..."
op whoami        # confirms the token works
```

A service account can only read the vaults it was granted. There is no unlock
prompt. Keep the token itself in a secret store or CI secret, never in a file in
the repo.

## Connect server (self-hosted, advanced)

Larger setups may use a 1Password Connect server with `OP_CONNECT_HOST` and
`OP_CONNECT_TOKEN`. The `op-secret` helper does not special-case Connect, but
`op` honors those env vars if they are set.
