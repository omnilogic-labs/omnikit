---
name: plan-queue
description: >-
  Read a plan that already exists — a folder of markdown step files, a single
  plan document, a set of tracker issues, or a mix — and return an ordered
  queue with a parallelism map: what runs now, what waits on what, what can
  share a wave, and where the run must stop and ask. Use before executing a
  pre-planned build, when work arrives as a runbook rather than as a board.
  Triggers include "run the plan in this folder", "work through these step
  files", "execute the runbook". Returns a digest, never step bodies, so the
  caller's context stays small.
context: fork
background: false
---

# plan-queue

Reads a plan so the caller does not have to. The output is a digest: an ordered queue, a
dependency and parallelism map, and the points where the run must stop and ask a human.
Step bodies never come back.

This is the plan-driven counterpart to `task-triage`. The difference is not cosmetic and it
governs everything below: **a board has no order until you give it one, and a plan already has
one.** Triage decides what matters. This skill decides only what can run _when_, and it takes
the rest as settled.

On Claude Code this runs forked (`context: fork`), so even this procedure never enters the
caller's window. The digest is the only thing that returns, and your final message must be
exactly that digest.

## Inputs

- **Plan source**, as invoked: "$ARGUMENTS". Any of, and any mix of:
  - a directory of markdown step files (the common case)
  - a single markdown plan document with steps inside it
  - tracker issue numbers, a label, or a focus area
  - a directory _plus_ issues, when a plan executes some steps as tickets
- **Adapter**: `.claude/night-shift.md` in the consuming repo. Keys read here: `plan_dir`
  (the default plan source when the argument names none), `repo` (only if the source includes
  tracker work), `concurrency_cap`, `overrides`. A missing `plan_dir` is fatal only when no
  plan source was passed either.

If no plan source resolves from the argument or the adapter, stop and say so. Do not go looking
for something plan-shaped in the repo.

## Use a scout for the reading pass

Dispatch `night-shift-scout` for the reading pass. Hand it the file list and the extraction
question; work from its `EXTRACT`. A plan folder is forty files of implementation detail, and
this skill's whole value is that none of it reaches the caller.

**Apply the adapter's `overrides` for the scout role to this dispatch.** This is usually the
first dispatch of a run and the one most often sent at a default model the adapter meant to
raise. Read `overrides` before dispatching, not after.

**Without a subagent roster** (any harness without agents), run the same
procedure in one context, reading in batches and writing each batch into the digest before the
next. Drop the concurrency cap to 1 for whatever runs after this.

## Step 1: enumerate

All source-specific calls live in this section. Everything after it works on the enumerated
list.

```bash
# A plan folder, in filename order — numbering is usually the intended order
ls -1 <plan_dir>/*.md

# The tracker half, if there is one
gh -R <repo> issue list --state open --limit 200 --json number,title,labels
gh -R <repo> issue view <n> --comments
```

**Find the index first.** A plan folder usually carries one: `00-*`, `README`, `index`, or the
lowest-numbered file. It is worth more than any single step file, because it holds the
execution order, the parallelism map, and the protocol every step assumes. Read it first and
let it frame everything else. If there is no index, filename order is the order, and say in
the digest that you inferred it.

Extract the run-shaping protocol while you are there — a first-step gate ("land 01 before
everything"), push cadence, tolerated breakage between steps, how the plan says to handle
drift. It returns in the digest's `PROTOCOL` line, because the orchestrator must honor it and
would otherwise apply its board habits instead. When the index and a step file disagree about
a dependency, the step file wins — it is closer to the work — and the disagreement goes in
`NOTES`.

## Step 2: extract per step

For each step, the scout returns exactly this and nothing else:

| Field      | Notes                                                              |
| ---------- | ------------------------------------------------------------------ |
| id         | the step's own identifier, or its filename stem                    |
| path       | absolute, so a delegate can be pointed at it                       |
| goal       | one line, the step's own words where possible                      |
| deps       | steps that must land first, as the step or the index declares them |
| parallel   | what the plan says about running it beside others                  |
| footprint  | the files and directories it touches                               |
| exclusive  | whether it moves, renames, or splits files (see below)             |
| tickets    | issues it closes or advances                                       |
| size       | the plan's own estimate, if it gives one                           |
| checkpoint | whether the plan says to confirm with a human before starting      |

A step whose file does not state its dependencies is not a step without dependencies. Say
`deps: undeclared` and let the footprint rules below decide. The two are different facts and
collapsing them is how a dependent step runs first.

## Step 3: the plan's order is the queue

Take it as given. Do not re-sort.

- **`priority_order` does not apply.** It orders a board where nobody decided the order.
- **A bug budget does not apply.** It exists to stop a board's severity sort from burying
  feature work. A plan already made that trade deliberately.
- **Severity does not promote a step.** A plan that puts a security fix at position 9 usually
  put something at position 1 that makes fixing it safe.

The one thing that reorders a plan is the user saying so at invocation. Record that as an
override in the digest rather than silently absorbing it.

If the plan's stated order and its declared dependencies contradict each other, report the
contradiction in `NOTES` and follow the dependencies. Do not pick a resolution silently.

## Step 4: build the parallelism map

A plan is mostly sequential. The map exists to catch the places it genuinely is not, not to
extract every drop of parallelism from it.

Group the queue into waves, honoring, in order:

1. **Declared dependencies.** A step runs only after every dependency has _landed on the base
   branch_, not merely returned green. The next worktree branches from the base branch, so a
   dependency that has not been integrated is a dependency the dependent step cannot see.
2. **Declared parallel-safety.** When the plan says a step is parallel-safe, or names a set that
   runs together, that is the answer.
3. **Footprint disjointness**, when the plan says nothing. Two steps may share a wave only if
   their footprints do not intersect and neither declares the other. Be honest about reach: an
   optimistic footprint produces two agents editing one file in two worktrees, and one of them
   loses.
4. **Exclusivity.** A step that moves, renames, splits, or reformats files conflicts with
   everything that touches those files, including work that only reads them today and edits
   them tomorrow. It runs alone, with the board drained. Mark it `excl`, and never guess this
   one down.
5. **The cap.** Never place more steps in a wave than `concurrency_cap`.

**Default to serial.** This is the inverse of the board default, and deliberately: a wrong
serial guess costs wall-clock, a wrong parallel guess costs a conflict in someone else's
worktree and a delegate that returns `BLOCKED` for a reason that has nothing to do with its
step. When you cannot tell, put it in its own wave.

## Step 5: buckets

Every step lands in exactly one:

- **`BUILD`** — runs in the pipeline.
- **`CHECKPOINT`** — the plan says to confirm with a human first, or it is destructive,
  outward-facing, or hard to reverse. The run stops here and asks. It does not skip ahead.
- **`SKIP`** — the plan explicitly says not to do it. Plans carry these on purpose ("explicitly
  not doing"), and a queue that quietly drops them looks identical to one that missed them.
  List them with the plan's own reason.
- **`DONE`** — already satisfied on the base branch. Only claim this when the step's own
  verification is cheap to check (a grep, a file's existence, a config value). When it is not,
  leave it `BUILD`: the planned delegate checks before implementing and returns
  `GREEN (no-op)`, which costs one lane and is honest. A wrongly-skipped step is a hole in the
  plan nobody notices until three steps later.

## Mixed sources: one unit per piece of work

A plan folder and a tracker will overlap. Deduplicate here, once, rather than in a lane.

- A step file that names an issue is **one unit**. The issue is context for the step; the step
  is the brief. Record the ticket so the integrator writes the right trailer.
- An issue with no step file is its own unit, placed in the queue by its dependencies. It has
  no plan file, so it dispatches to the ordinary `night-shift-delegate`, which plans it — say
  so in the digest, because the caller dispatches a different agent for it.
- A step file that says a ticket is executed "as written" means the ticket is the brief and the
  step is the pointer. Still one unit; note which document carries the detail.

Never queue the same work twice under two names.

## Ticket hygiene

Same rule as triage, applied narrowly: comment on a ticket only when a plan step reveals
something the thread does not already say, once, marked as automated. A plan run's bookkeeping
belongs in the task list, not in a comment thread.

## Return: a digest, not a plan

```
PLAN: docs/checkout-rewrite — 41 steps, index 00-README.md (order: declared)
PROTOCOL: land 01 before all else; push after each step (a push deploys); tree may be briefly rough between steps

STEPS:
  01  BUILD       green main + deploy-on-green   deps: —        excl   ci config, smoke suite
  02  BUILD       drop retry from payments       deps: —               billing/payments.rb      closes #334
  03  BUILD       session-rotation race          deps: —               auth/session.rb
  12  BUILD       error boundaries               deps: 01              ui/**                    closes #343, #326
  18  BUILD       split cart service             deps: 02,03    excl   services/cart/**
  41  CHECKPOINT  storage backend swap           deps: 18,22,30 excl   plan says: confirm with the owner

WAVES (ordered, cap 3):
  W1: 01                    (exclusive)
  W2: 02, 03, 04            (disjoint footprints, plan declares parallel-safe)
  W3: 12                    (waits on 01 landing)
  W4: 18                    (exclusive — drain before provisioning)

CHECKPOINTS: 41 (workspace split; plan says confirm with the owner before starting)
SKIP: hand-dedup of client wire types (plan: superseded by step 30's generator)
DONE: 07 (already on main in a1b2c3d)
TRACKER: #334 -> step 02, #343/#326 -> step 12, #338 -> step 33; #329 has no step file (ordinary delegate)
NOTES: step 22 declares deps on 18 but the index orders it before — following the dependency
```

Return that and nothing else. No step bodies, no restated instructions, no code sketches. If the
caller needs the detail, the delegate reads the step file itself — that is the whole point of
passing a path instead of a paragraph.
