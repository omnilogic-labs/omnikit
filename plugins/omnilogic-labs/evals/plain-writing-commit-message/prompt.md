---
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

Using the plain-writing skill, write a commit message for a change that makes the retry loop in src/http/client.ts stop after 5 attempts instead of retrying forever, because an outage on 2026-09-03 left workers spinning. Do not run anything.
