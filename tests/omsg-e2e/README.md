# omsg end-to-end harness

These scripts drive real Codex, agy and Claude Code sessions through omsg. They spend model tokens and take minutes, so `bun test` does not run them. Run them by hand from the repo root after a change to omsg, its hooks or the Claude mod.

| Script                          | What passes                                                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mid-task.sh <codex\|agy>`      | A nonce sent after tool call 5 of 15 is in the final answer, the hook printed it, and the job never ran `omsg read` itself.                              |
| `silence.sh [codex] [agy]`      | 20 tool calls with no mail: the per-call hooks and Stop print 0 bytes.                                                                                   |
| `registration.sh [codex] [agy]` | Three jobs of one host in one project are three live entries in `omsg who`; gone after a normal exit and after `kill -9` (an aliased one shows offline). |
| `owner.sh [codex] [agy]`        | The owner, in a detached shell with no agent ancestor, reads the job's question and replies; the job echoes the reply's nonce.                           |
| `relay.sh`                      | codex mails an agy worker (by `OMSG_NAME`), which sends a nonce on to a `claude -p` session; the Claude mod delivers it.                                 |
| `tokens.sh [base]`              | Prints the bytes and estimated tokens removed with the inbox tool and skill, and the bytes `omsg read` and `omsg count` print.                           |

Each exits 0 on a pass and prints `PASS`.

## Needs

- `codex`, `agy` and `claude` on PATH and signed in, plus `bun` and `jq`. Each script needs only the hosts it runs.
- Linux, or macOS with `setsid` (owner.sh).

## What they touch

Each run makes its own scratch dir under `$OMSG_E2E_TMP` (default `$TMPDIR` or `/tmp`) and prints its path. In it:

- `mail/` is `OMSG_DIR`, so the real mailbox is never touched.
- `bin/omsg` links to this checkout's `bin/omsg` and is first on PATH, for the agents' own `omsg send`.
- `work/` is the git repo the jobs run in, with project-local `.codex/hooks.json` and `.agents/hooks.json` calling this checkout's omsg by absolute path through `hooks/tap.sh`, which keeps a copy of every byte the hooks print in `hooks/<host>.out` and `hooks/<host>.<event>.out`.
- `runs/<tag>.jsonl` is each job's event stream, `<tag>.last` its final answer.

HOME stays real so the hosts stay signed in. No global hook file is written: codex runs with `--dangerously-bypass-hook-trust` and agy reads the project's `.agents/hooks.json`. Codex and agy also run without approvals or sandbox (`--dangerously-bypass-approvals-and-sandbox`, `--dangerously-skip-permissions`), and Claude with `--permission-mode bypassPermissions`; the prompts ask only for `sleep`, `echo` and `omsg` commands. Use these flags in this harness only.

Every message carries a fresh random nonce, and the checks read the nonce from the final answer, so a pass cannot come from a cached or invented reply.
