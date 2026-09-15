---
name: worktree-pipeline
description: Run a queue of disjoint units of work through isolated git worktrees and land them: provision an environment per unit, dispatch an agent that owns it end to end, route green results to a serialized integration, then publish and tear down. Use for batch or unattended builds across many issues, parallel feature work that must not collide, or any run where each unit needs its own branch, port, and data store. Triggers include "work through these issues", "run the queue", "build these in parallel worktrees".
---

# worktree-pipeline

Takes a queue of disjoint units and runs them through isolated worktrees to a landed commit. This skill knows which agent handles which stage; the agents know nothing about the pipeline.

Everything project-specific comes from the adapter at `.claude/night-shift.md`. See `references/adapter.md` for the spec, `references/example-adapter.md` for a filled-in one, `roles.yaml` for the portable tier-to-provider mapping, and `references/models-and-effort.md` for resolution. On Codex with agent delegation, read `references/codex-roster.md` before the first dispatch. This skill calls hooks by name and never contains a literal project command.

## Before the first dispatch

- **Confirm nested spawning for the active harness.** Claude Code needs `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` at least `3`. Codex needs agent delegation available. If the required depth is unavailable, use the no-roster procedure rather than dispatching delegates that will silently do everything themselves.
- **Run the adapter's `preflight` hook.** Fix or report what it flags. A pipeline started against a broken environment produces failures that look like bad code.
- **Confirm the queue is actually disjoint.** Overlapping units are not a parallelism problem to solve later; they are a serialization decision to make now.

## Per unit

### 1. Provision

Create a worktree branched from the base branch, with its own dependencies, environment file, isolated data store, and a unique port — through the adapter's `provision` hook, because the delegate assumes it is already done. (The `Agent` tool's native `isolation: worktree` is not a substitute: it branches from the default branch and provisions none of that.)

Starting the dev server is the adapter's call. Some `provision` hooks start it; others deliberately leave the port free, because at provision time the worktree is a copy of the base branch with nothing implemented, so a server started then is stale before anyone needs it. Provision says which it did on its `SERVER=` line.

Record what provisioning printed: worktree path, port, data store name, server state. Those are values you pass onward, never values an agent hardcodes.

If provisioning fails, the unit never enters a lane. Report it as an environment problem and move on.

### 2. Dispatch

Dispatch `night-shift-delegate` against that worktree, in the background, with the unit and the environment facts (see the contract below). If the queue came from a plan, this is `night-shift-planned-delegate` — see "Running from a plan".

**Do not wait on it.** If a lane is free and disjoint work remains, start the next one. Waiting on a running unit while ready work sits idle is the failure mode this pipeline exists to prevent.

### 3. Route the result

- `GREEN` goes to the integration queue.
- `BLOCKED` is parked with its reason and reported. It never stalls the other lanes, and it never gets retried in place without a change to its inputs.
- An environment failure returns to provisioning once, then parks.

A result is what the delegate's final message said, and only that. A lane that has returned nothing has no result: report the stall and park it, rather than reconstructing an outcome from git state, the process table, or how long it feels like it has been.

Record the outcome as one line. Do not restate the delegate's report.

### 4. Integrate

Dispatch `night-shift-integrator`, **one at a time**, even when several units are ready. Integration is the one stage where parallelism produces conflicts instead of throughput. It lands a squash commit and returns the SHA. It never pushes.

### 5. Publish and tear down

- Push according to the policy: `after-each`, `batched` (once at the end or at a stated milestone), or `never` (default; land locally and leave publishing to a human). Pushing stays with the caller, not the integrator, so it stays serialized behind integration and only clean built state reaches the remote.
- Run the `teardown` hook: remove the worktree, drop its data store, free the port. A teardown that refuses because something is still running in the tree is a correct refusal — the unit's server outlived it. Run the adapter's `sweep` hook if it defines one, or stop the leftovers by working directory, and retry. Reaching for `--force` instead tears the tree out from under whatever is still using it, which is what the refusal exists to prevent.
- Reconcile the task: confirm the ticket closed if the trailer said it would, note where it shipped, update the tracking issue.

## Running from a plan instead of a board

When the queue came from `plan-queue` rather than `task-triage`, the machinery above is unchanged and six things differ:

- **Dispatch `night-shift-planned-delegate`.** The plan already carries the approach and usually the verification, so the planner stage does not apply. A unit that came from the tracker with no plan file behind it still gets the ordinary delegate; the digest says which is which.
- **Pass the step file's absolute path**, plus the plan folder as a read-only path. Never a summary: a paraphrase in a dispatch brief is the orchestrator re-planning the step it was handed.
- **The plan's order replaces the priority queue.** Fill lanes from the wave map. Do not reorder by severity, do not apply a bug budget, do not promote a step because it sounds urgent.
- **Dependencies gate provisioning, not dispatch.** A worktree branches from base at provision time, so a step whose dependency is green but not yet integrated would be provisioned without it.
- **An exclusive step gets the whole board.** Drain the lanes, integrate, then provision it alone. A move-only split racing a feature branch conflicts in every file it touched, and resolving it by hand throws away the property that made the split reviewable.
- **Branch names carry no issue number**, so an `integrate` hook deriving a trailer from `issue-<n>` will not fire. Name plan branches `plan-<id>-<slug>` and pass the trailer yourself, from the delegate's `CLOSES` and `REFS`.

A `CHECKPOINT` in the digest stops the run: report what needs confirming and ask. `BLOCKED (plan)` is not a build failure and does not retry — park it, surface it verbatim, keep the lanes moving.

## Rules this skill enforces

- **Concurrency cap on live units, default 3.** It counts units, not processes, and it is low because each unit fans out its own subagents and browsers. Three live units is already a dozen-plus processes.
- **At most one integration at a time.**
- **Parallel lanes must be disjoint by file footprint.** Overlapping ready units run serially.
- **One stuck unit occupies at most one lane.**
- **Everything branches from the base branch**, and everything merges back to it.

## The contract every dispatched agent receives

Inject this at dispatch, filled in with values. No agent should have to be told it twice, and none should ever hardcode any of it.

- **Worktree path.** "`cd` there first and confirm. All edits and version control commands stay inside it. Never touch the primary checkout."
- **Read the built repo's ground rules first** — an `AGENTS.md` or `CLAUDE.md` at the worktree root. Dispatched agents do not inherit it, and it is where the repo's non-negotiables live.
- **Read-only paths** it may consult (reference implementations, docs, an outer planning repo), passed as values.
- **The assigned port**, and what is on it, taken from provision's `SERVER=` line rather than assumed: either "already running on it" or "yours and unused; build and start it with the `start` hook, and stop it when done."
- **Whoever starts a server stops it, and stops the whole process group it started.** `pkill -f "<start command>"` matches every lane's server, so one unit's cleanup kills the app another unit is mid-verification against — which surfaces as an unreachable server and a `FAIL` written against working code. Selecting by name is the error; so is stopping the single process the launch reported, because a start command commonly wraps the process that actually holds the port. Stopping the wrapper leaves the port bound.
- **Confirm the stop before starting a replacement, and confirm the replacement is the one answering.** A port that is still held silently rejects the new server, and a health check keeps succeeding against the old one — so the unit verifies the previous build and reports a pass. If the adapter defines a `serving` hook, that is what it is for; otherwise confirm from the launch's own fresh output, never from a bare health check.
- **Sweep the worktree before returning.** Run the adapter's `sweep` hook if it defines one; otherwise enumerate processes by their working directory under the worktree and stop them, which is lane-safe where matching on a command name is not. This is the agent's own last act, not the pipeline's cleanup.
- **Its data store is its own.** Mutate freely; reset with the `seed` hook. An unreachable data store is an environment failure to report, not evidence the work is broken.
- **Toolchain commands by hook name** (`typecheck`, `build`, `test`, `seed`, `start`, and `serving` and `sweep` where the adapter defines them), never as literal commands.
- **Browser work goes through `browser-buddy`**, with URL, credentials, and the exact journey.
- **The required return shape** for that agent type, and that its final message is how that return is delivered.
- **Its own sub-dispatches are synchronous** — `run_in_background: false`, passed explicitly. The harness backgrounds subagents by default, and a backgrounded verifier's grade is delivered to the _orchestrator_ rather than the delegate that needs it, leaving the delegate with no verdict and no way to ask. Say this even though the delegate role already does; it is one line, and the failure it prevents is a fabricated grade.
- **Scratch filenames are namespaced to the unit.** A shared scratch directory means `server.log` in lane A is the same path as in lane B. Prefix with the unit id (`issue-126-server.log`). A lane that overwrote another's log has manufactured evidence, and a verifier quoting it will cite another lane's port as proof about this one.
- **The base branch.**

### And nothing else. Hand over the ticket, not the answer.

That list is the whole brief: the ticket number, and the facts the agent cannot reach on its own. **Do not diagnose the defect, name a fix, sketch an architecture, or list candidate approaches.** The delegate reads the ticket, the code, and the prior art — all of which it has better access to than you, who have read none of them.

The cost is not wasted tokens, it is destroyed evidence. A delegate handed a hypothesis returns that hypothesis; its verifier then grades against criteria derived from the same hypothesis. The whole chain agrees with you, and none of it is independent confirmation — including when you were right, because nothing in the run could have shown otherwise.

Three shapes that look like context and land as instructions:

- **"Consider whether X."** Read as an option, obeyed as a directive.
- **"Prefer X over Y", "fix the class not the instance."** A design ruling dressed as a principle.
- **"This is easy to get wrong because…"** An agent that cannot find the trap will not be saved by a sentence, and one that could have now never demonstrates it.

The test: **could the agent learn this from the ticket, the repo, or its own skills?** If yes, cut it. Keep only what is true about the environment, or about work that landed elsewhere in this run.

Two things this does **not** forbid, because they are facts rather than judgments:

- **What recently landed on files this unit will touch**, so a rebase is expected rather than discovered. State the commits; stop short of saying how to resolve.
- **Scope boundaries the ticket does not carry** — a part gated on an unanswered question, a sibling issue owning an adjacent file, a composed unit built later. Only the run knows these.

A brief that grows past the contract plus a scope boundary is usually the orchestrator solving the ticket in advance.

## Dispatch record

Log every dispatch with its model and reasoning level, so a bad result traces to a downgrade:

```
#126 delegate tier=2 model=gpt-5.6-sol reasoning=high lane=2 worktree=/w/issue-126 port=4102
```

Resolve the role's portable tier through `roles.yaml`, then log the provider model and reasoning that actually ran. Never log a level that did not take effect. Full rules are in `references/models-and-effort.md`.

## Without a subagent roster

If the active harness has no agent delegation, read `references/without-subagents.md`: the same procedure runs in one context, at a cap of 1. Do not read it when a subagent roster is available.
