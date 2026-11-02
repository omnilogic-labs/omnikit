# Dispatching workers on Claude Code

The role prompts are in this skill's folder: `roles/planner.md`, `roles/builder.md` and `roles/verifier.md`. Each
holds the role's prompt body, with no frontmatter.

Every dispatch prompt names two things: the task reference that `scripts/ledger ref <task>` prints (an issue,
`owner/repo#n`, which the worker reads itself with `gh issue view <n> -R <owner/repo> --json title,body --jq
'.title, .body'`; or in file mode `<plan path>#<task>`) and the worktree path. Never paste the plan text. Ask for a
reply of ten lines or fewer, also saved to the worktree's `ledger-reply.md` (`ledger.md`, Writing cheaply).

| Role     | Tier                                                  |
| -------- | ----------------------------------------------------- |
| planner  | deep, always                                          |
| builder  | fast for rote or straightforward work; deep otherwise |
| verifier | fast per task; deep for a milestone review            |

`models.md` gives the model name for each tier on each host.

## Claude Code

- Dispatch the plugin agents by name with the Agent tool, `subagent_type: "omnilogic-labs:<role>"`
  (for example `omnilogic-labs:builder`).
- Set `model` on the call to the tier's model: `opus` for deep, `sonnet` for fast. The agents
  already default to the deep tier for the planner and the fast tier for the builder and verifier, so override the
  model only for a complicated build or a milestone review.
- Run independent workers in one message so they run in parallel. Long ones can run in the background; you are
  notified when they finish.
- Do not use `isolation: "worktree"` or `EnterWorktree`. Builders work in the worktree `scripts/wt` made.
- Ask a finished worker a follow-up with `SendMessage` instead of reading its files.
- To check what is already running before you dispatch, look at your live background agents.

## The index reader

The reader that keeps `ledger index` current (`ledger.md`, Reading cheaply) needs no judgement, so it runs on the
host's lightest model:

- Claude Code: a `general-purpose` agent with `model: "haiku"`, in the background. Use
  `sonnet` only if its gists come back wrong.

## No subagents

If the host cannot run workers, play each role yourself, one after another:

1. Read the role's `roles/<role>.md` and follow it for that step only.
2. Keep each role's output in its file (plan, commit, verify report) so the next role starts from the file, not
   from memory.
3. Still use one worktree per task and still run every acceptance command.

Say in every report to the owner that verification was not independent: the same agent built and verified the
work.

## External workers

Any role can be run by Codex or agy. Dispatch one `omnilogic-labs:external-runner` agent per job, in the
background when you run several. Tell it `engine` (`codex` or `agy`), the `task`, and the worktree path as `cwd`.
Optional: `model`, `effort`, `timeoutSec`, and `sandbox` (`none`, the default, so the worker can commit in its
worktree and reach the network; or `workspace-write`, `read-only`).

The runner shows as a subagent row: open it to see the worker's progress, or run `/workers`. It replies with the
worker's exit code, job dir and final message, so its reply is the answer. Ignore the separate background task
notification for the same job. Never call `mcp__omnilogic-labs__external_worker` yourself: from the main conversation it is refused.

Always pass the worktree path as `cwd`; it defaults to the session root.
