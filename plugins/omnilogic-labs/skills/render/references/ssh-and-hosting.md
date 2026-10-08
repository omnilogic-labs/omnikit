# SSH access and the hosting model

## Picking the right SSH key (the recurring failure)

An organization often has more than one Render account: a personal account plus
one or more team/org accounts. SSH keys are authorized per account. A key from
the wrong account is rejected:

```
Permission denied (publickey)
```

How to get it right:

- Identify which **account owns the service** (the dashboard shows the owner; the
  service id `srv-...` belongs to exactly one account). Use the key whose label
  matches that account.
- Keep one key file per account and pass the right one with `-i`:
  `~/.ssh/render_personal_ed25519`, `~/.ssh/render_<org>_ed25519`, and so on.
  Do not overwrite a single shared `~/.ssh/render_ed25519`; that is how the wrong
  key ends up cached and the mistake repeats.
- On `Permission denied (publickey)`: switch to the correct account's key (or
  re-fetch it if it lives in a secret manager). Do not retry the same key. If you
  recently cached a key at the default path, it may be the wrong account's; remove
  it and use an account-specific path instead.

The key file can come from anywhere (an env var, a secret manager, a manual
download). `render-ssh` only consumes a file path; it does not fetch keys.

## Host key flags (why render-ssh suppresses them)

Render rotates and reuses SSH host keys across deploys, so `known_hosts`
produces false "host key changed" and "bad signature" warnings that would block
automation. `render-ssh` always passes:

- `StrictHostKeyChecking=no`
- `UserKnownHostsFile=/dev/null`
- `LogLevel=ERROR`
- `ConnectTimeout=10` (instances may be sleeping; fail fast and retry)

Never trust a Render host-key warning as a security signal; it is noise here.

## Connection details

- SSH target format: `srv-XXXXXXXX@ssh.<region>.render.com`, for example
  `srv-d7p4v73eo5us73dmpma0@ssh.oregon.render.com`. Find it on the service's
  Connect page in the dashboard, or in a project's env as `RENDER_HOST`.
- Only deployed, running services are reachable. A suspended or never-deployed
  service has no SSH endpoint.
- SSH is for inspection and one-off commands. Persistent changes belong in the
  repo or env config, since the filesystem is ephemeral.

## On-box layout

- Application code: `/opt/render/project/src`.
- The service's full environment (including secrets) is already exported in the
  shell. Do not echo secret env vars (`DATABASE_URL` with credentials,
  auth secrets) into the transcript when running diagnostics.
- Runtime versions are whatever the service was built with (check `node -v`,
  `python --version`, etc. on the box).

## Internal vs external networking

- **External**: every `web` service is published at
  `https://<name>.onrender.com` and exposes `RENDER_EXTERNAL_URL`. Custom domains
  layer on top.
- **Internal**: private services (`pserv`), managed Postgres (`dpg-...`), and Redis
  are reachable only from inside the owning account's private network in that
  region. Their hostnames do not resolve from your laptop.
- Consequence: anything that talks to the internal `DATABASE_URL` (migrations,
  `psql`, admin scripts) must run **on the service over SSH**, not locally. A
  typical migration:

  ```bash
  render-ssh -i ~/.ssh/render_<account>_ed25519 \
    srv-XXXX@ssh.oregon.render.com 'cd /opt/render/project/src && npm run migrate'
  ```

  If a service exposes an _external_ database connection string (public
  `ipAllowList`), you can reach it directly, but production databases are usually
  internal-only.

## Regions and persistence

- Regions: `oregon`, `ohio`, `virginia`, `frankfurt`, `singapore`. The SSH host
  encodes the region. Internal networking and datastore locality are per region;
  cross-region internal traffic is not private.
- Containers are ephemeral. Only a mounted persistent disk survives a deploy or
  restart; code changes, `/tmp`, and anything written outside the disk are lost
  on the next deploy.

## Quick checklist for "ssh into render and do X"

1. Determine the owning account and select that account's key file.
2. `render-ssh -i <that key> srv-XXXX@ssh.<region>.render.com '<command>'`.
3. If `Permission denied (publickey)`: wrong account key or stale cache; switch
   keys and retry once.
4. For DB or migration work, run the command on the box (internal hosts are not
   reachable locally), and keep secrets out of the transcript.
