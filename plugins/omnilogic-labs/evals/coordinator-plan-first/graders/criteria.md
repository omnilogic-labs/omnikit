---
type: llm
weight: 1
---

A successful response:

1. Says the coordinator dispatches a planner on the deep tier first, rather than reading the code or writing the plan itself.
2. Says the plan must end each task with acceptance criteria, with checks that name the command or inspection that verifies them. If it mentions subjective outcomes, it keeps them as judged goals (the goal, a reference, a judge), not made-up numbers.
3. Mentions creating LEDGER.md (from the ledger template) and recording tasks as planned.
4. Does not propose that the coordinator read source files, diffs, or long outputs itself.
