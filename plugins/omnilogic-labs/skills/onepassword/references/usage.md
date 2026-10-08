# Usage

Everything here uses raw `op`. Under WSL substitute `op.exe`, or just use
`bin/op-secret`, which picks the right binary and cleans the output.

## Secret references

A secret reference addresses one field: `op://<vault>/<item>/<field>`. Spaces in
names are fine inside quotes.

```bash
op read "op://Personal/Stripe/api key"
op read "op://Personal/deploy key/private key"
```

`op read` reveals the value by default and writes it to stdout. Use `-o FILE` to
write to a file, though `op-secret --out` is preferable because it also cleans
and chmods.

## Reading a field by item title

When you know the item title but not the full reference:

```bash
op item get "Stripe" --fields "api key" --reveal
op item get "Stripe" --fields "api key" --reveal --vault Personal
```

`--reveal` is mandatory for concealed fields; without it you get a masked
reference. `--fields` takes the field label; comma-separate to read several.

Inspect an item to find the exact field labels:

```bash
op item get "Stripe"                 # human-readable summary
op item get "Stripe" --format json   # exact field ids and labels
```

## Listing

```bash
op vault list
op item list                       # all items you can see
op item list --vault Personal
op item list --categories "SSH Key"
```

## Injecting secrets without touching disk

`op run` resolves `op://` references in the environment for the duration of a
command, so secrets never land in a file or your shell history:

```bash
op run --env-file=.env -- ./deploy.sh
```

where `.env` contains references, not values:

```
STRIPE_KEY=op://Personal/Stripe/api key
DATABASE_URL=op://Personal/prod-db/connection string
```

`op inject` fills a template, substituting `op://` references:

```bash
op inject -i config.tpl.yaml -o config.yaml
```

## Capturing into the environment

For a single token, capture into a variable (it stays in memory, not on disk):

```bash
export GITHUB_TOKEN="$(op read 'op://Personal/GitHub/token' | tr -d '\r')"
```

With the helper this is just:

```bash
export GITHUB_TOKEN="$(bin/op-secret 'op://Personal/GitHub/token')"
```

## SSH keys

The most error-prone case, because keys are multiline and permission-sensitive:

```bash
bin/op-secret --item "deploy key" --field "private key" --out ~/.ssh/deploy_ed25519
ssh-keygen -y -f ~/.ssh/deploy_ed25519     # confirms the key parses (prints the public key)
```

1Password also offers an SSH agent that serves keys without writing them to
disk at all; if it is enabled, `ssh` can use keys directly through
`SSH_AUTH_SOCK`. Writing the key to a file with the helper is the portable
fallback when the agent is not set up.
