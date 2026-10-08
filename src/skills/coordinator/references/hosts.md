# Dispatching workers on {{host.label}}

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

<!-- @if claude -->

## Claude Code

- Dispatch the plugin agents by name with the {{tool.agent}} tool, `{{tool.agentType}}: "omnilogic-labs:<role>"`
  (for example `omnilogic-labs:builder`).
- Set `model` on the call to the tier's model: `{{tier.deep}}` for deep, `{{tier.fast}}` for fast. The agents
  already default to the deep tier for the planner and the fast tier for the builder and verifier, so override the
  model only for a complicated build or a milestone review.
- Run independent workers in one message so they run in parallel. Long ones can run in the background; you are
  notified when they finish.
- Do not use `isolation: "worktree"` or `EnterWorktree`. Builders work in the worktree `scripts/wt` made.
- Ask a finished worker a follow-up with `{{tool.message}}` instead of reading its files.
- To check what is already running before you dispatch, look at your live background agents.

<!-- @endif -->

<!-- @if codex -->

## Codex

- The installer adds the roles as Codex custom agents named `planner`, `builder` and `verifier`. Dispatch one with
  `{{tool.agent}}`, `agent_type: "<role>"` and the task as the `message`, then wait for it with `wait_agent`.
- If the role is not an installed custom agent, read `roles/<role>.md` and pass its body as the start of the
  worker's prompt instead.
- Pick each worker's model and effort by tier: deep is `{{tier.deep}}` with effort `{{effort.deep}}`, fast is
  `{{tier.fast}}` with effort `{{effort.fast}}`.
- Without spawn tools, run a worker as a separate process from inside the worktree:
  `codex exec -C <worktree> --sandbox workspace-write -m <model> "<role prompt + task>"`.
- Do not use Codex's own worktree mode. Builders work in the worktree `scripts/wt` made.

<!-- @endif -->

<!-- @if agy -->

## Antigravity (agy)

- The installer adds the roles as agy agents named `planner`, `builder` and `verifier` (in
  `~/.gemini/config/agents`); `agy agents` lists what is installed. Dispatch one with `{{tool.agent}}`: one entry in
  `Subagents` with `TypeName: "<role>"`, a short `Role` title, and the task as the `Prompt`. Entries in one call run
  in parallel; each reports back when done, and `send_message` reaches a running one.
- Pick each worker's model by tier with the entry's `Model`: `{{tier.deep}}` for deep, `{{tier.fast}}` for fast.
  It takes only `inherit`, `flash_lite`, `flash` or `pro`.
- If the role is not an installed agent (`{{tool.agent}}` answers "not found"), read `roles/<role>.md` and pass its
  body as the start of the `Prompt` instead, with `TypeName` set to an agent that is installed, or define one first
  with `define_subagent`.
- Leave `Workspace` at `inherit` (the current directory) and point the worker at its worktree path. Do not use
  `branch` or `share`, which make their own workspace.

<!-- @endif -->

## No subagents

If the host cannot run workers, play each role yourself, one after another:

1. Read the role's `roles/<role>.md` and follow it for that step only.
2. Keep each role's output in its file (plan, commit, verify report) so the next role starts from the file, not
   from memory.
3. Still use one worktree per task and still run every acceptance command.

Say in every report to the owner that verification was not independent: the same agent built and verified the
work.

<!-- @if claude -->

## External workers

Any role can be run by Codex or agy. Two ways:

- Dispatch the `omnilogic-labs:external-runner` agent (a visible subagent row). Tell it `engine` (`codex` or
  `agy`), the `task`, and the worktree path as `cwd`.
- Or call the `{{tool.external}}` tool directly with `engine`, `task` and `cwd`. Optional: `model`, `effort`,
  `timeoutSec`.

Always pass the worktree path as `cwd`; it defaults to the session root. The job runs in the background. When it
ends you get a task notification with a short summary and an `output_file` path. Read that file once: it holds
the final answer. Do not poll.

<!-- @endif -->
