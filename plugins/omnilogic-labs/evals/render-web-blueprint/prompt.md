---
max_turns: 6
allowed_tools: [Read, Glob, Grep, Skill]
---

Using the render skill, write a render.yaml for a Node web service named shop-api (build: npm ci && npm run build, start: npm start, health check /healthz) with a Postgres database named shop-db whose connection string is injected as DATABASE_URL. Do not run anything; output only the YAML and a one-line note.
