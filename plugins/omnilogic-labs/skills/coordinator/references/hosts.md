# Dispatching workers, by host

The role prompts are the plugin's agent files: `planner.md`, `builder.md` and `verifier.md`. From this skill's
folder they are at `../../agents/<role>.md`. A host that loads plugin agents uses them by name. A host that does not
should read the file and pass its body (everything after the frontmatter) as the start of the worker's prompt.

Every dispatch prompt names three things: the plan file, the task name, and the worktree path. Ask for a reply of
ten lines or fewer.

| Role     | Tier                                                  |
| -------- | ----------------------------------------------------- |
| planner  | deep, always                                          |
| builder  | fast for rote or straightforward work; deep otherwise |
| verifier | fast per task; deep for a milestone review            |

`models.md` gives the model name for each tier on each host.

## Claude Code

- Dispatch with the Agent tool, `subagent_type: "omnilogic-labs:<role>"` (for example
  `omnilogic-labs:builder`).
- Set `model` on the call to the tier's Claude Code model from `models.md`. The agent files already default to
  the deep tier for the planner and the fast tier for the builder and verifier, so override the model only for a
  complicated build or a milestone review.
- Run independent workers in one message so they run in parallel. Long ones can run in the background; you are
  notified when they finish.
- Do not use `isolation: "worktree"` or `EnterWorktree`. Builders work in the worktree `scripts/wt` made.
- Ask a finished worker a follow-up with `SendMessage` instead of reading its files.
- To check what is already running before you dispatch, look at your live background agents.

## Codex

- Codex does not load plugin agents. Read `../../agents/<role>.md` and use its body as the role prompt.
- Dispatch with its subagent spawn tool (`spawn_agent`), then wait for results with its wait tool. Pick each
  worker's model and effort from the Codex column of `models.md`.
- Without spawn tools, run a worker as a separate process from inside the worktree:
  `codex exec -C <worktree> --sandbox workspace-write -m <model> "<role prompt + task>"`.
- Do not use Codex's own worktree mode. Builders work in the worktree `scripts/wt` made.

## Antigravity (agy)

- Read `../../agents/<role>.md` and use its body as the role prompt.
- Dispatch with `invoke_subagent`. Pick each worker's model from the agy column of `models.md`.
- Use the workspace mode that inherits the current directory, and point the worker at its worktree path. Do not
  use a mode that makes its own branch.

## No subagents

If the host cannot run workers, play each role yourself, one after another:

1. Read the role file and follow it for that step only.
2. Keep each role's output in its file (plan, commit, verify report) so the next role starts from the file, not
   from memory.
3. Still use one worktree per task and still run every acceptance command.

Say in every report to the owner that verification was not independent: the same agent built and verified the
work.

## External workers

Any role can be run by Codex or agy. Two ways, from Claude Code:

- Dispatch the `omnilogic-labs:external-runner` agent (a visible subagent row). Tell it `engine` (`codex` or
  `agy`), the `task`, and the worktree path as `cwd`.
- Or call the `mcp__omnilogic-labs__external_worker` tool directly with `engine`, `task` and `cwd`. Optional:
  `model`, `effort`, `timeoutSec`.

Always pass the worktree path as `cwd`; it defaults to the session root. The job runs in the background. When it
ends you get a task notification with a short summary and an `output_file` path. Read that file once: it holds
the final answer. Do not poll.
