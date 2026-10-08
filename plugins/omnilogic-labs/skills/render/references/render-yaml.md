# render.yaml (Blueprint) reference

`render.yaml` at the repo root declares services and datastores as code. Render
reads it to create and sync infrastructure (this is a "Blueprint"). Field names
below match Render's current spec; where Render renamed a field, the older alias
is noted. When this disagrees with the live docs at
https://render.com/docs/blueprint-spec, trust the docs.

## Top-level keys

```yaml
previews:
  generation: automatic # automatic | manual | off (per-PR preview environments)
  expireAfterDays: 3

services: [] # web, pserv, worker, cron, static
databases: [] # managed Postgres
envVarGroups: [] # shared env var sets referenced by services
```

## services

Common fields (most service types):

```yaml
services:
  - type: web # web | pserv | worker | cron | static
    name: my-api # unique within the account
    runtime: node # node | python | ruby | go | rust | elixir | docker | image
    # `env:` is the older alias for `runtime:`
    plan: starter # free | starter | standard | pro | ... (per service type)
    region: oregon # oregon | ohio | virginia | frankfurt | singapore
    branch: main # branch to auto-deploy from
    rootDir: . # subdirectory to treat as the service root (monorepos)
    autoDeploy: true # deploy on push to branch (default true)
    buildCommand: npm ci && npm run build
    startCommand: npm start
    preDeployCommand: npm run migrate # after build, before traffic; NO disk mounted (see below)
    healthCheckPath: /healthz # web only; must return 2xx
    numInstances: 1 # fixed instance count (omit if using scaling)
    maxShutdownDelaySeconds: 30
    envVars: []
    buildFilter: # only build when matching paths change
      paths:
        - src/**
      ignoredPaths:
        - "**/*.md"
```

### Docker / prebuilt image services

```yaml
- type: web
  name: my-image-svc
  runtime: docker
  dockerfilePath: ./Dockerfile
  dockerContext: .
  # Or deploy a prebuilt image instead of building:
  # runtime: image
  # image:
  #   url: docker.io/library/nginx:latest
```

### Autoscaling (instead of numInstances)

```yaml
scaling:
  minInstances: 1
  maxInstances: 3
  targetMemoryPercent: 70
  targetCPUPercent: 70
```

### Persistent disk (worker/web/pserv)

```yaml
disk:
  name: data
  mountPath: /var/data
  sizeGB: 10
```

Only the mounted disk survives a deploy; the rest of the container is ephemeral.

The disk is mounted **only on the running service** — not on the build machine
and not on the pre-deploy machine. So for a file-backed DB on the disk (e.g.
SQLite at `/var/data/app.db`), run migrations/seeds in `startCommand`, not in
`buildCommand`/`preDeployCommand` — the latter write to an ephemeral path that
is discarded, and the live service then boots against an empty DB. Also open the
DB connection lazily so `build` never touches the disk. See the "Disks and
migrations" section in `SKILL.md`.

### Custom domains

```yaml
domains:
  - api.example.com
```

### Static sites

```yaml
- type: static
  name: my-site
  buildCommand: npm ci && npm run build
  staticPublishPath: ./dist
  pullRequestPreviewsEnabled: true
  routes:
    - type: rewrite
      source: /*
      destination: /index.html
  headers:
    - path: /*
      name: X-Frame-Options
      value: DENY
```

### Cron jobs

```yaml
- type: cron
  name: nightly
  runtime: node
  schedule: "0 3 * * *" # standard cron, UTC
  buildCommand: npm ci
  startCommand: node scripts/nightly.js
```

## envVars

Per-service or inside an `envVarGroup`. Forms:

```yaml
envVars:
  - key: NODE_ENV
    value: production # literal value

  - key: SECRET_TOKEN
    sync: false # set in dashboard, not in yaml; not synced

  - key: SESSION_SECRET
    generateValue: true # Render generates a strong value once

  - key: DATABASE_URL
    fromDatabase:
      name: my-db
      property: connectionString # connectionString | host | port | user | password | database

  - key: API_URL
    fromService:
      name: my-api
      type: web
      property: hostport # host | port | hostport | url

  - fromGroup: shared-config # pull in an entire envVarGroup
```

## envVarGroups

```yaml
envVarGroups:
  - name: shared-config
    envVars:
      - key: LOG_LEVEL
        value: info
      - key: SENTRY_DSN
        sync: false
```

Reference from a service with `- fromGroup: shared-config`.

## databases (managed Postgres)

```yaml
databases:
  - name: my-db
    plan: basic-256mb # free | basic-256mb | basic-1gb | pro-...
    region: oregon
    databaseName: myapp # optional explicit db name
    user: myapp # optional explicit role
    postgresMajorVersion: "16"
    diskSizeGB: 10
    ipAllowList: [] # empty list = internal-only (no public access)
    highAvailability:
      enabled: false
    readReplicas:
      - name: my-db-replica
```

An empty `ipAllowList: []` makes the database reachable only from inside
Render's network, which is the common production posture; that is why migrations
must run over SSH on the service (see `ssh-and-hosting.md`).

## Notes

- Redis / Key Value services are managed in the dashboard or via the API; they
  are not always expressible in `render.yaml` depending on plan and account.
- After editing `render.yaml`, sync it: push the branch (if the Blueprint is
  connected) or apply it from the dashboard. Render shows a plan of changes
  before applying.
- Validate structure locally with any YAML linter; Render does the semantic
  validation at sync time.
