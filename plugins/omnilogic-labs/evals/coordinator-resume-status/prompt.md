---
max_turns: 10
allowed_tools: [Read, Glob, Grep, Skill]
---

Use the coordinator skill. You are a fresh coordinator context resuming someone else's run; nothing from the earlier session survives. `scripts/ledger status` printed:

```text
Run #40: Add a --json flag to every command
Now:
  Wave 2 building. json-cmds was with a builder when the last session ended.
Wave now: 2
building: json-cmds #42
ready: json-docs #43
blocked: json-auth #44: Needs staging credentials (owner item posted)
merged: 1, dropped: 0, open: 3
```

Max lanes is 4. Say what you read next, what you dispatch, and what you record, in order. Do not dispatch anything.
