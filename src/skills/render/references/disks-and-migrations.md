# Disks and migrations: the build machine has no disk

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
  service's private network: so those migrations also run best in `startCommand`
  or over SSH, not from your laptop.
