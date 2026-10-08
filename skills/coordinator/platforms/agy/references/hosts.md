# Dispatching workers on Antigravity (agy)

The role prompts are in this skill's folder: `roles/planner.md`, `roles/builder.md` and `roles/verifier.md`. Each
holds the role's prompt body, with no frontmatter.

Every dispatch prompt names three things: the plan file, the task name, and the worktree path. Ask for a reply of
ten lines or fewer.

| Role     | Tier                                                  |
| -------- | ----------------------------------------------------- |
| planner  | deep, always                                          |
| builder  | fast for rote or straightforward work; deep otherwise |
| verifier | fast per task; deep for a milestone review            |

`models.md` gives the model name for each tier on each host.

## Antigravity (agy)

- Read `roles/<role>.md` and use its body as the role prompt.
- Dispatch with `invoke_subagent`. Pick each worker's model by tier: `pro` for deep, `flash` for
  fast.
- Use the workspace mode that inherits the current directory, and point the worker at its worktree path. Do not
  use a mode that makes its own branch.

## No subagents

If the host cannot run workers, play each role yourself, one after another:

1. Read the role's `roles/<role>.md` and follow it for that step only.
2. Keep each role's output in its file (plan, commit, verify report) so the next role starts from the file, not
   from memory.
3. Still use one worktree per task and still run every acceptance command.

Say in every report to the owner that verification was not independent: the same agent built and verified the
work.
