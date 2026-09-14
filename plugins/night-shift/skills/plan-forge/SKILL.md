---
name: plan-forge
description: >-
  Produce an executable plan folder — an indexed sequence of self-contained
  markdown step files — for a large body of work: a product built from
  scratch, an audit's remediation, a migration, a rewrite, anything too big
  for one sitting. The output is directly consumable by plan-queue and
  night-shift-planned-delegate, or by any competent agent pointed at the
  folder and told to work through it. Use when the user wants the plan
  written down for later or cheaper execution, not the work done now.
  Triggers include "write a plan folder", "make an implementation playbook",
  "turn this audit into a plan", "plan this out for another agent to build".
effort: high
---

# plan-forge

You are about to write a plan that will be executed by an agent who was not present for any
of this — not the investigation, not the design argument, not the codebase spelunking. The
plan folder is the only thing that crosses that gap. Everything below serves one property:
**a competent, cheaper agent can be handed the folder and the one-paragraph protocol, and
produce the work.**

The work does not have to be code cleanup. A product from scratch, a migration, a rewrite, a
content system, an ops runbook — anything that decomposes into ordered, verifiable steps
forges the same way. What varies is Phase 1 (what you investigate); the shape of the output
does not.

## The output contract

A folder (default `docs/<plan-slug>/` in the planning repo; the user's word wins) containing:

- **`00-README.md`** — the index: what the plan is and why it exists, the consuming-agent
  protocol, the step table with sizes, the wave/parallelism map, the checkpoint marks, and a
  "deliberately NOT doing" list. The protocol states the run-shaping facts a runner must
  honor: which step gates the rest, push cadence, tolerated breakage between steps, how to
  handle drift.
- **`NN-slug.md`** step files — one unit of work each, following
  [references/step-template.md](references/step-template.md) exactly. That template is the
  compatibility contract: `plan-queue` derives its queue from these headers, and
  `night-shift-planned-delegate` takes Verify as its acceptance criteria, Don't as graded
  scope fences, and Commit as the message. Deviate from the template and the plan still reads
  well to a human while quietly breaking the machinery that runs it.

The plan repo and the build repo are often different. Say which is which in the index. The
plan folder is a set of briefs, never worksheets — nothing in the plan records progress.

## Models

Authoring runs on fable deliberately — `night-shift-planner` and `night-shift-plan-author`
both pin it. A plan is written once and executed many steps deep; an error in it is copied
into every downstream step, while execution errors stay local. Spend at the point of highest
leverage and let execution be the cheap part.

## The pipeline

Run the phases in order. Each writes its output to a scratch directory (the harness's
scratchpad, or `/tmp` failing that) so later phases and dispatched agents read files, not
your paraphrase.

### Phase 0 — frame

Settle, with the user where the request leaves it open: the goal in one sentence; the target
repo(s); the plan folder location; what kind of body of work this is; the execution shape it
must fit (a pipeline run, a solo agent working a day, a mix); any standing constraints (the
adapter's hooks and base branch if the repo has `.claude/night-shift.md`, the repo's own
ground-rules files). If the goal is still a vague product idea rather than a body of work,
the `primer` skill is the front-end for that — a primer brief is an excellent Phase-0 input,
and this skill picks up where it stops.

### Phase 1 — investigate

Fan out `night-shift-researcher` agents in parallel, one per area of the work, with scouts
underneath them doing the bulk reading. For an existing codebase: what is actually there,
with `file:line` evidence and quoted fragments (the authors will re-verify, but they can only
re-verify claims specific enough to check). For a greenfield product: the requirements, the
reference implementations, the constraint surface. Include an external-research pass when the
work has one (how do teams keep X healthy; what does the current API actually accept) —
grounding a plan in what the world knows beats re-deriving it.

Distill everything into one findings digest file. Findings the plan will not act on do not
go in it.

### Phase 2 — design

Dispatch two or more `night-shift-planner` passes in parallel with deliberately different
lenses — for remediation work: execution sequencing vs. the gates that keep it fixed; for a
product: the build order vs. the architecture and quality floor. Distinct lenses catch what
redundant passes cannot. Reconcile the designs yourself; where they disagree, that is a
decision to make visibly, not an average to take.

### Phase 3 — fix the spine

Before any step file exists, freeze: the full numbered step list (numbers, slugs, titles,
one-line scopes), phases, dependencies, parallel-safety and exclusivity, checkpoint marks,
and sizes. Write it into the authoring standard along with the repo facts every step must
respect and the template rules.

Two spine rules earn their place in every plan:

- **The first step buys safety for all the rest.** Whatever makes continuous landing safe —
  a deploy-on-green gate, a CI pipeline, a smoke suite, a backup — is step one, before any
  substantive change. A plan that defers its safety gate concentrates its risk at the moment
  of maximum churn.
- **Pre-name every shared artifact.** Any helper, config key, allowlist, or file that one
  step creates and another consumes gets its exact name declared in the spine. Parallel
  authors who each guess the name produce a plan that disagrees with itself, and the
  disagreement surfaces as an executor grepping for a thing that was never called that.

### Phase 4 — author

Dispatch `night-shift-plan-author` agents in parallel batches of three to five files, grouped
so each batch is thematically coherent. Every batch gets the same inputs: the digest, the
designs, the standard, the target repo path, the plan folder path, and its exact filenames.
The authors verify claims against the repo before writing them and return summaries plus
corrections — read the corrections; they are the difference between the plan and the truth,
found at the cheapest possible moment.

### Phase 5 — index and harmonize

Write `00-README.md` yourself, from the authors' returned summaries — sizes and dependencies
as written, not as you predicted them. State in it that each step file's own Depends and
Parallel-safe lines are authoritative over the table.

Then the checks, none optional:

- **Template compliance**, mechanically: every section header present in every file
  (`grep -L` per required section), numbering gapless, every file in the index exactly once.
- **The joints**: for each pre-named shared artifact, grep that the creating step and every
  consuming step use the same name. This is where parallel authorship breaks, and a grep
  finds it in seconds.
- **Spot-read** the highest-stakes files — the first step, every checkpoint step, the largest
  step — end to end, against the digest.
- Reconcile drift back into the index rather than into your memory of what the plan says.

## Plan-design rules

- **Steps are sized for one agent session** (S under an hour, M one to three, L a half-day).
  Anything bigger splits before it is written, not during execution.
- **Anchor by content, not coordinates.** Cite `file:line` as of the authoring date, warn
  that lines drift, and always pair a citation with the quoted code the executor can search
  for.
- **Every step verifiable.** Verify runs real commands with expected outcomes — the repo's
  own toolchain gates always, step-specific proof besides. An unverifiable step is design
  debt the executor inherits.
- **Scope fences are content.** What a step must not do is as load-bearing as what it must,
  and it is the section a capable executor most needs.
- **Checkpoints where a human decides.** Destructive, outward-facing, hard-to-reverse, or
  genuinely open calls get a step that stops the run and asks. Mark them in the index; the
  runner treats everything after a checkpoint as ordered on the assumption it happened.
- **Say what you are not doing.** The index's "deliberately NOT doing" list is what keeps an
  executor from wandering into work the design already rejected — the rejected option
  invisible in the plan is the one most likely to be helpfully re-attempted.
- **Serial by default, parallelism declared.** Mark the pairings that are safe and the exact
  file conflicts that make others unsafe; a runner defaults undeclared pairings to serial,
  so an undeclared safe pairing costs only wall-clock, while an undeclared conflict costs a
  ruined worktree.

## Without a subagent roster

On a harness without agents, run the same phases in one context: investigate in batches,
design as two written passes, author the files serially against the same standard. The
verify-before-write rule survives every degradation — it is the one this skill exists to
carry.

## Handoff

End by naming: the folder, the step count, the checkpoints, and how to run it — the repo's
plan-run command where one exists (`/orchestrate --plan <folder>`, or the repo's alias for
it), and the solo form for everyone else: _"there is a sequential-ish plan inside this
folder; read `00-README.md` first, then code, test, and commit each step one at a time,
pushing as the protocol says; steps marked CHECKPOINT stop and ask."_
