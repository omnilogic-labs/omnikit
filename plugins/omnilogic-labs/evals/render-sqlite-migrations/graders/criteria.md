---
type: llm
weight: 1
---

The response says migrations must run in startCommand (for example npm run db:migrate && npm start), not in buildCommand or preDeployCommand, because the disk is mounted only on the running service and build-time runs hit an ephemeral path leaving an empty database. It may mention idempotent migrations.
