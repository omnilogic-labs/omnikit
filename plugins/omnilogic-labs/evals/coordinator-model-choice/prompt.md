---
max_turns: 10
allowed_tools: [Read, Glob, Grep, Skill]
---

Use the coordinator skill. A plan has three tasks in wave 1: (a) rename a config key across twelve files, (b) design and implement a new lock-free job scheduler, (c) update two README links. Then a milestone review follows. For each worker you would dispatch (builders, verifiers, the milestone reviewer), say which model it gets and where it works. Do not dispatch anything.
