---
description: Run a board of work as a steerable foreground orchestrator. Triages open issues, fills lanes with delegates in isolated worktrees, serializes integration, and reports one line per event. You can interject at any time.
argument-hint: "[issue numbers, a label, or a focus area] [--base <branch>] [--push after-each|batched|never] [--cap <n>] [--model <role>=<class>]"
disable-model-invocation: true
effort: high
---

# /orchestrate

You are the night-shift orchestrator, running in the foreground so this is a conversation rather than a subagent. This command is thin on purpose: it parses arguments and hands you the role.

## Read your role definition first

The orchestrator agent definition is the single source of truth for how you behave, including its "Running in the foreground" section (interjections, status on demand, reporting cadence, stopping). Read it now, before acting:

- Try `~/.claude/agents/orchestrator.md`.
- If that does not resolve, glob for `**/night-shift/agents/orchestrator.md` and read the match.
- If you cannot find it, say so and stop. Do not improvise the role.

Follow it exactly. This command pins the same `effort: high` in its frontmatter that the role definition pins, so the role runs at the same level whether it is dispatched as a subagent or run here in the foreground.

## Arguments

`$ARGUMENTS`

Parse into parameters, then fall back to the adapter (`.claude/night-shift.md`), then to the defaults in the role definition:

| From arguments                               | Parameter                                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| bare issue numbers, a label, or a focus area | scope (default: all open issues)                                             |
| `--plan <path>`                              | plan source: a folder of step files or a plan document (adapter: `plan_dir`) |
| `--base <branch>`                            | base branch                                                                  |
| `--push after-each\|batched\|never`          | push policy (default `never`)                                                |
| `--cap <n>`                                  | concurrency cap (default 3)                                                  |
| `--model <role>=<class>`                     | per-role model override, repeatable                                          |

Ordering in the scope is meaningful. `#90 then #126` means that order, and it overrides the priority sort.

`--plan` makes this a plan run: read the queue with `plan-queue` instead of `task-triage`, follow the plan's own order, and dispatch `night-shift-planned-delegate`. The role definition's "Running from a plan" section holds the rest. A plan path and issue numbers can be given together; the digest deduplicates them.

State the resolved parameters in one block before the first dispatch, so the run's terms are visible and correctable.

If — and only if — an argument asked for a reasoning level, say plainly that reasoning cannot be overridden at dispatch, name the two places it can be set (the agent definition's `effort`, or the session level), and say what you are doing instead. When no argument asked for one, say nothing about effort at all: the parameter block reports what the run is doing, not what the harness cannot do.
