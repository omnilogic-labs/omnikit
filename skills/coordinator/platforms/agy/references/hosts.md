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

- The installer adds the roles as agy agents named `planner`, `builder` and `verifier` (in
  `~/.gemini/config/agents`), each with its own tool allowlist; `agy agents` lists what is installed. Dispatch one
  with `invoke_subagent`: `TypeName: "<role>"`, `Model: "inherit"`, a short `Role` title, and the task as the
  `Prompt`. Calls run in parallel; each reports back when done, and `send_message` reaches a running one.
- Both tiers use `Model: "inherit"` (so workers inherit the session's model) unless the owner asks for another
  setting (`flash_lite`, `flash` or `pro`).
- If the role is not an installed agent (`invoke_subagent` answers "not found"), read `roles/<role>.md` and pass its
  body as the start of the `Prompt` instead, with `TypeName: "self"`, or define one first with
  `define_subagent`.
- Leave `Workspace` at `inherit` (the current directory) and point the worker at its worktree path. Do not use
  `branch` or `share`, which make their own workspace.
- For an external review (agy on `gemini-4-argon-high` or Codex on `gpt-6.1-sol`), dispatch a relay
  subagent with `invoke_subagent` (`TypeName: "self"`, `Model: "flash_lite"`) whose only job is to
  run the one CLI command (`agy --model gemini-4-argon-high -p "<prompt>" > <out>` or
  `codex exec -m gpt-6.1-sol -c model_reasoning_effort=xhigh -s read-only -C <worktree> "<prompt>" > <out>`),
  wait for it to finish, save the output to a file, and return the file path and exit code. Never pass `--effort` to
  `agy` when the model slug already pins the effort level.

## No subagents

If the host cannot run workers, play each role yourself, one after another:

1. Read the role's `roles/<role>.md` and follow it for that step only.
2. Keep each role's output in its file (plan, commit, verify report) so the next role starts from the file, not
   from memory.
3. Still use one worktree per task and still run every acceptance command.

Say in every report to the owner that verification was not independent: the same agent built and verified the
work.
