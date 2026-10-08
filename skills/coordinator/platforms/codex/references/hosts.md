# Dispatching workers on Codex

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

## Codex

- The installer adds the roles as Codex custom agents named `planner`, `builder` and `verifier`. Dispatch one with
  `spawn_agent`, `agent_type: "<role>"` and the task as the `message`, then wait for it with `wait_agent`.
- If the role is not an installed custom agent, read `roles/<role>.md` and pass its body as the start of the
  worker's prompt instead.
- Pick each worker's model and effort by tier: deep is `gpt-6.1-sol` with effort `high`, fast is
  `gpt-6-luna` with effort `medium`.
- Without spawn tools, run a worker as a separate process from inside the worktree:
  `codex exec -C <worktree> --sandbox workspace-write -m <model> "<role prompt + task>"`.
- Do not use Codex's own worktree mode. Builders work in the worktree `scripts/wt` made.

## No subagents

If the host cannot run workers, play each role yourself, one after another:

1. Read the role's `roles/<role>.md` and follow it for that step only.
2. Keep each role's output in its file (plan, commit, verify report) so the next role starts from the file, not
   from memory.
3. Still use one worktree per task and still run every acceptance command.

Say in every report to the owner that verification was not independent: the same agent built and verified the
work.
