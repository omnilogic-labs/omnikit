---
type: llm
weight: 1
---

A successful response:

1. Gives the builders for (a) and (c) the fast model and the builder for (b) the strongest model.
2. Gives the per-task verifiers the fast model and the milestone reviewer the strongest model.
3. Puts each builder in its own git worktree (for example via `scripts/wt create`).
4. Notes that (a) and (c) are small enough that they may share a lane, or otherwise keeps lanes within the max lanes setting. This point is optional and only adds credit.
