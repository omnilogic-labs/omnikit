# render

Covers the `render.yaml` blueprint format, SSH access to live services, the hosting model, and the REST API. Two helpers, `bin/render-ssh` and `bin/render-api`, are paths relative to this SKILL.md's directory. They are plain bash (need `ssh`, `curl`, optionally `jq`). On Windows run them from Git Bash, or from PowerShell as `& "$env:ProgramFiles\Git\bin\bash.exe" <skill dir>/bin/render-api ...`, never bare (Windows opens an "Open with" dialog and hangs).

## Credentials (bring your own)

Source does not matter (env var, secret manager, file). Fetch them first, then run the helpers.

- SSH private key authorized for the Render account that owns the service. `render-ssh` reads `-i FILE`, else `$RENDER_SSH_KEY`, else `~/.ssh/render_ed25519`.
- API key: `render-api` reads `RENDER_API_KEY` from the environment.

## Which account's key (the common failure)

An organization often has several Render accounts (personal plus team/org), each with its own authorized SSH keys and its own API keys. A wrong key fails with `Permission denied (publickey)` (SSH), or `401`, or `404` on a service visible in that account's dashboard (API).

- Use the key for the account that owns the service, not the one used last.
- Cache per account (`~/.ssh/render_personal_ed25519`, `~/.ssh/render_<org>_ed25519`), never one shared file.
- On `Permission denied (publickey)`, switch to the correct or re-fetched key and retry once; do not retry the same key.
- `bin/render-api GET /owners` shows which owner an API key can act on.

Details: `references/ssh-and-hosting.md`, `references/api.md`.

## SSH into a service

```bash
# One command:
bin/render-ssh -i ~/.ssh/render_personal_ed25519 srv-xxxxxxxx@ssh.oregon.render.com 'whoami && pwd'
# Interactive shell: omit the command.
```

The helper always applies `StrictHostKeyChecking=no`, `UserKnownHostsFile=/dev/null`, `LogLevel=ERROR`, `ConnectTimeout=10`. Render reuses host keys across deploys, so ignore host-key warnings.

On the box:

- The app lives at `/opt/render/project/src`.
- Internal datastore hosts (`dpg-...` Postgres, Redis) resolve only inside the service's private network, so migrations and admin tasks that use the internal `DATABASE_URL` run over SSH on the service, not from a laptop.
- The service environment, including secrets, is already exported. Do not echo secret env vars into the transcript.

## REST API

```bash
export RENDER_API_KEY=...
bin/render-api GET /services
bin/render-api GET "/services?limit=20&type=web_service"
bin/render-api POST /services/srv-xxxx/deploys      # trigger a deploy
```

Base URL `https://api.render.com/v1`; `services`, `/services`, and `/v1/services` are equivalent. Auth is a Bearer token. Output is pretty-printed with `jq` when present. Endpoints and pagination: `references/api.md`.

## render.yaml (Blueprints)

`render.yaml` at the repo root declares services and datastores; Render syncs infrastructure from it.

```yaml
services:
  - type: web
    name: my-api
    runtime: node
    plan: starter
    buildCommand: npm ci && npm run build
    startCommand: npm start
    healthCheckPath: /healthz
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase:
          name: my-db
          property: connectionString

databases:
  - name: my-db
    plan: basic-256mb
```

`templates/render.yaml` is a fuller starter to copy. Field reference (service types, env var groups, disks, cron jobs, previews, autoDeploy): `references/render-yaml.md`.

## Hosting model in brief

- Service types: `web` (public HTTP), `pserv` (private, internal only), `worker` (no inbound), `cron` (scheduled), `static` (static site).
- Every web service gets `https://<name>.onrender.com` and exposes `RENDER_EXTERNAL_URL`; custom domains attach on top. Private services are reachable only at their internal hostname.
- Regions: `oregon`, `ohio`, `virginia`, `frankfurt`, `singapore`. The SSH host encodes the region (`ssh.oregon.render.com`); internal networking is per region.
- Containers are ephemeral; only mounted disks survive a deploy. Code and `/tmp` do not.

## Disks and migrations

A persistent disk is mounted only on the running service, never on the build or pre-deploy machine. Do not run migrations or seeds that target a disk path in `buildCommand` or `preDeployCommand`; they hit an ephemeral copy and the live service boots empty (`no such table`, HTTP 500). Run them in `startCommand`:

```yaml
startCommand: npm run db:migrate && npm run db:seed && npm start
```

Full rules (idempotency, lazy DB connection, unblocking a broken service over SSH, Postgres/Redis): `references/disks-and-migrations.md`.

## References

- `references/render-yaml.md`: full Blueprint spec.
- `references/api.md`: endpoints, auth, pagination, common calls.
- `references/ssh-and-hosting.md`: account and key selection, host and URL patterns, on-box layout, regions, networking, migrations over SSH.
- `references/disks-and-migrations.md`: why build-time migrations on a disk vanish and where to run them.
- `templates/render.yaml`: starter blueprint.
