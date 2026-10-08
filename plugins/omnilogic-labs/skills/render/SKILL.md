---
name: render
description: >-
  Work with Render.com: author and manage render.yaml blueprints, SSH into
  running services, understand how Render hosting is laid out, and call the
  Render REST API. Use when the user wants to deploy or configure a Render
  service, edit render.yaml, ssh into a Render host to inspect logs or run
  migrations, query the Render API, or understand Render networking and the
  on-box filesystem. Triggers include "deploy to render", "render.yaml",
  "render blueprint", "ssh into render", "render logs", "render api",
  "srv-... host", "run a migration on render".
---

# render

Everything for operating on Render.com: the `render.yaml` blueprint format, SSH
access to live services, the hosting model (services, regions, networking, on-box
paths), and the REST API. Ships two helpers, `bin/render-ssh` and
`bin/render-api`.

## Credentials (bring your own)

This skill needs two kinds of credential and does not care where they come from
(an environment variable, a secret manager, a file you placed yourself):

- **SSH private key** authorized for the Render account that owns the service.
  `render-ssh` reads it from `-i FILE`, else `$RENDER_SSH_KEY`, else
  `~/.ssh/render_ed25519`.
- **API key** for the REST API. `render-api` reads `RENDER_API_KEY` from the
  environment.

If you keep these in a secret manager, fetch them into a file or env var first,
then run the helpers. The helpers stay decoupled so they also work when the
secret is already in your environment.

## Calling the helpers

The Skill loader prints `Base directory for this skill: <path>`. Call the helpers
relative to it:

```bash
RSSH="<base-dir>/bin/render-ssh"
RAPI="<base-dir>/bin/render-api"
```

Or `cd <base-dir>` and call `bin/render-ssh` / `bin/render-api`. Both are plain
bash (need `ssh`, `curl`, and optionally `jq`).

## The thing that bites everyone: which SSH key

An organization often has **more than one Render account** (a personal account
and one or more team/org accounts). Each account has its own set of authorized
SSH keys. A key from the wrong account fails with:

```
Permission denied (publickey)
```

This is the single most common Render SSH failure. Rules:

- Use the key whose label matches the **account that owns the service**, not
  whichever key you used last.
- Do not assume one global key works everywhere. Cache per account, for example
  `~/.ssh/render_personal_ed25519` and `~/.ssh/render_<org>_ed25519`, instead of
  clobbering a single `~/.ssh/render_ed25519`.
- On `Permission denied (publickey)`, you almost certainly have the wrong
  account's key, or a stale cached key. Swap to the correct one (re-fetch it if
  it lives in a secret manager) and retry; do not keep retrying the same key.

`references/ssh-and-hosting.md` has the full account/key reasoning.

## SSH into a service

```bash
# Run one command and return:
bin/render-ssh -i ~/.ssh/render_personal_ed25519 \
  srv-xxxxxxxx@ssh.oregon.render.com 'whoami && pwd'

# Interactive shell (omit the command):
bin/render-ssh -i ~/.ssh/render_personal_ed25519 srv-xxxxxxxx@ssh.oregon.render.com
```

The helper always applies the four flags Render needs:
`StrictHostKeyChecking=no`, `UserKnownHostsFile=/dev/null`, `LogLevel=ERROR`,
`ConnectTimeout=10`. Render rotates and reuses host keys across deploys, so
`known_hosts` is worse than useless; never trust host-key warnings for Render.

On the box:

- The app lives at `/opt/render/project/src`.
- Internal datastore hosts (`dpg-...` Postgres, Redis) are reachable **only from
  inside the service's private network**, so database migrations and admin tasks
  that touch the internal `DATABASE_URL` must be run over SSH on the service, not
  from your laptop.
- The service environment (including secrets) is already exported in the shell.
  Do not echo secret env vars into the transcript when running diagnostics.

## Call the REST API

```bash
export RENDER_API_KEY=...        # from your env or secret manager
bin/render-api GET /services
bin/render-api GET "/services?limit=20&type=web_service"
bin/render-api GET /services/srv-xxxx/deploys
bin/render-api POST /services/srv-xxxx/deploys      # trigger a deploy
```

Base URL is `https://api.render.com/v1`; the path argument is normalized so
`services`, `/services`, and `/v1/services` are equivalent. Auth is a Bearer
token. Output is pretty-printed with `jq` when present. Full endpoint and
pagination notes in `references/api.md`.

**Which API key (same multi-account trap as SSH).** An API key is scoped to one
owner (account or team). If you have more than one Render account, you have more
than one API key, and `RENDER_API_KEY` must be the one for the account that owns
the service you are touching. The symptom of the wrong key is a `401`, or a
`404` on a service you can plainly see in that account's dashboard. Pick the key
whose account owns the `srv-...`; `render-api GET /owners` shows which owner a
key can act on.

## render.yaml (Blueprints)

`render.yaml` at the repo root declares your services and datastores as code;
Render syncs infrastructure from it (Blueprint). A minimal web service plus
database:

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

`templates/render.yaml` is a fuller starter. The complete field reference
(service types, env var groups, disks, cron jobs, preview environments,
autoDeploy) is in `references/render-yaml.md`.

## Hosting model in brief

- **Service types**: `web` (public HTTP), `pserv` (private service, internal
  only), `worker` (no inbound), `cron` (scheduled), `static` (static site).
- **URLs**: every web service gets `https://<name>.onrender.com` and exposes
  `RENDER_EXTERNAL_URL`; custom domains attach on top. Private services are
  reachable only at their internal hostname.
- **Regions**: `oregon`, `ohio`, `virginia`, `frankfurt`, `singapore`. The SSH
  host encodes the region (`ssh.oregon.render.com`). Internal networking is
  per-region.
- **Persistence**: containers are ephemeral; only mounted disks survive a
  deploy. Code and `/tmp` do not.

More in `references/ssh-and-hosting.md`.

## Disks and migrations: the build machine has no disk

A persistent disk is mounted **only on the running service**, never on the
build machine and never on the pre-deploy machine. This bites hard with
file-backed databases (SQLite on a disk):

- **Do NOT run migrations/seeds in `buildCommand` or `preDeployCommand`** when
  they target a path on the disk (e.g. `DATABASE_PATH=/var/data/app.db`). They
  will "succeed" against an ephemeral copy of that path and then vanish, so the
  live service boots against an empty database (`no such table: ...`, HTTP 500).
- **Run them in `startCommand`**, which executes on the service with the disk
  mounted:
  ```yaml
  startCommand: npm run db:migrate && npm run db:seed && npm start
  ```
  Render keeps the build's `node_modules` at runtime, so devDependencies like
  `drizzle-kit` / `prisma` / `tsx` are available in `startCommand`. Keep
  migrations idempotent since this runs on every boot.
- **Open the DB connection lazily** (a `getDb()` singleton created on first
  request), never at module top level. Anything imported during `next build` /
  bundling must not touch the disk, or the build fails or bakes in a bad path.
- Symptom-to-cause: a live service throwing `SQLITE_ERROR: no such table` right
  after a "successful" deploy means migrations ran somewhere without the disk.
  Move them to `startCommand`. To unblock an already-broken service immediately,
  SSH in and run the migrate/seed from `/opt/render/project/src` (the disk is
  mounted there); the fix persists because the disk survives deploys.
- Postgres/Redis (`dpg-...`) don't have this problem (they're network services,
  not disks), but their internal hostnames are still only reachable from the
  service's private network — so those migrations also run best in `startCommand`
  or over SSH, not from your laptop.

## What lives where

- `bin/render-ssh`: SSH with Render's required flags; key from file/env.
- `bin/render-api`: curl wrapper for the REST API; key from `RENDER_API_KEY`.
- `references/render-yaml.md`: full Blueprint spec.
- `references/api.md`: REST API endpoints, auth, pagination, common calls.
- `references/ssh-and-hosting.md`: account/key selection, host and URL patterns,
  on-box layout, regions, internal networking, running migrations.
- `templates/render.yaml`: starter blueprint to copy and edit.
