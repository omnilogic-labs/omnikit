---
type: llm
weight: 1
---

A successful response:

1. Does not mark the task passed; it states that UNVERIFIED never counts as passed.
2. Treats the missing credential as an owner item (a reason to stop or block that task), records it in the ledger, and keeps other runnable tasks going.
3. For the second FAIL, sends the task to a planner (strongest model) to rescope rather than back to the builder a third time.
4. Uses the ledger states from the skill (for example blocked, fixing, planned).
