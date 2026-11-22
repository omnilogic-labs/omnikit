# Example project file

A filled-in `.agents/bughunt.md` for Otea, a Next.js app behind a password gate, with a separate query service,
a worker, and a Postgres database on Render. Paths are shortened to `~`, `<repo>` (the main checkout) and
`<omnikit>`; the email address is a placeholder. Copy the shape, not the values.

```markdown
# Bughunt

- **Target:** https://otea.watch. A local build from your worktree is where you reproduce and retest.
- **Gate:** password gate on the first page. The password is in `~/.config/otea-secrets/AUTH_PASS`; type it with
  `agent-browser fill <ref> "$(cat ~/.config/otea-secrets/AUTH_PASS)"`. Never print it. A local build uses the
  throwaway password `otea-local`.
- **Secrets:** `~/.config/otea-secrets/`, one file per name, and `<repo>/.env.local`. Read a value only inside the
  command that uses it.
- **Worktree:** the caller runs `<omnikit>/plugins/omnilogic-labs/skills/coordinator/scripts/wt create <name>`,
  which also installs dependencies.
- **Local build:** the caller starts the shared local copy of production once
  (`LOCALPROD_NOGATE=1 <repo>/scripts/local-prod.sh start`); hunters never start, stop or restart it. In your
  worktree, in one shell, load its env, pick a free port, build and start the web app in the background:
  `set -a; . <repo>/.env.local; set +a`
  `eval "$(sed -n '/^STATE=/,/^WEB_PORT=/p;/^sec()/p;/^gen()/,/^}/p;/^env_common()/,/^}/p' <repo>/scripts/local-prod.sh)"; env_common`
  `PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1])')`
  `export APP_URL=http://localhost:$PORT BETTER_AUTH_URL=http://localhost:$PORT AUTH_PASS=otea-local`
  `pnpm --filter @otea/web build && pnpm --filter @otea/web exec next start -p "$PORT"`; stop it by PID.
  A Playwright spec that reproduces the bug also works: `pnpm e2e prod <spec>` builds and serves on its own.
- **Quick check:** `pnpm check:quick`
- **Data:** production Postgres, read only: `render ssh` into `otea-web`, then `psql "$DATABASE_URL"` and
  `SET default_transaction_read_only = on;` before any query. Never write.
- **Email:** only to `you+hunter@example.com`, read with the Gmail tools. Sign in with that address only.
- **Replies:** to the path the caller gives.
- **Rules:** follow `<repo>/AGENTS.md` (no em or en dashes, Spanish copy only, every colour and size from a
  design token, `design/` `research/` `mockups/` read only). Never write inside .git or ~/.claude. No sudo.
```
