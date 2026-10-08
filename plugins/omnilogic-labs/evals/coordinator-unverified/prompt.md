---
max_turns: 10
allowed_tools: [Read, Glob, Grep, Skill]
---

Use the coordinator skill. A verifier just replied for task `auth-refresh`: "criterion 1 PASS, criterion 2 PASS, criterion 3 UNVERIFIED (no staging credentials)". This is the task's first verify round. What state does the task go to in the ledger, and what do you do next? Then: suppose instead it was the second FAIL on this task. What do you do? Do not dispatch anything.
