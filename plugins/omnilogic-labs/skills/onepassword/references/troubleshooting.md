# Troubleshooting

Symptom-to-cause table for the failures that actually happen.

| Symptom                                                                 | Cause                                                              | Fix                                                                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Output looks like `op://...` or a masked dot string, not the real value | concealed field read without revealing                             | add `--reveal` to `op item get --fields`, or use `op read`. `op-secret` does this for you.                 |
| `op: command not found`                                                 | under WSL there is no native `op`                                  | use `op.exe`, or use `op-secret`, which falls back automatically.                                          |
| SSH key rejected: "invalid format" / "error in libcrypto"               | stray `\r` bytes from `op.exe`, or wrapping quotes from `--reveal` | strip them (`tr -d '\r'` plus removing lone leading/trailing `"` lines). `op-secret` cleans automatically. |
| SSH key rejected: "Permissions ... are too open"                        | key file is not mode 600                                           | `chmod 600 <file>`. `op-secret --out`/`--cache` always do this.                                            |
| "you are not currently signed in"                                       | no active session                                                  | `eval "$(op signin)"`, or set `OP_SERVICE_ACCOUNT_TOKEN`.                                                  |
| Unlock prompt never appears (WSL)                                       | Windows app CLI integration disabled                               | enable **Settings, Developer, Integrate with 1Password CLI** in the Windows app.                           |
| "more than one item matches"                                            | duplicate item titles across vaults                                | pass `--vault <name>` (or `--account`) to disambiguate.                                                    |
| "isn't an item in any vault" or field not found                         | wrong title or field label                                         | run `op item get "<title>" --format json` to see exact labels.                                             |
| Multiple accounts, reads the wrong one                                  | default account is not the one you want                            | pass `--account <name>` (`op account list` to see names).                                                  |

## Verifying a fetched secret without leaking it

Do not print secrets. Confirm them indirectly:

```bash
head -1 key.pem          # shows only the key header line
wc -c key.pem            # non-zero byte count
ssh-keygen -y -f key.pem # parses a private key and prints its PUBLIC half
```

## Quick sanity checks

```bash
op whoami                # am I signed in, and as whom
op vault list            # can I see vaults
op item get "<title>"    # does the item exist and what fields does it have
```
