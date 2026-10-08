# Primer template

A primer is a single Markdown file at the target repo root, written for a fresh
Claude Code session as its primary reader and the human as secondary reader. It
is self-contained: everything needed to understand and plan the build lives in
it or in clearly named source material it points to.

Aim for 150 to 470 lines. Long is fine; vague is not. Every section earns its
place. Fill the skeleton below; drop sections that genuinely do not apply, but
do not drop "Hard constraints", "Phases", or "What not to do".

## Skeleton

```markdown
# <Project name>

## Your job (read this first)

You are Claude Code. <Name> dropped this document into a fresh repo and started
you up. Here is what to do with it.

1. Read this document fully before doing anything else. It is long on purpose.
2. Use it to structure `docs/init.md` and a set of `docs/init/NN-slug.md` task
   files, following the Phases section near the bottom. You own the task
   breakdown; this document does not enumerate every task.
3. Do not execute the build autonomously. Stop after you produce the init plan
   and present it for review. Treat the plan as a proposal.
4. When something is ambiguous, surface a specific question with a proposed
   answer, not an open "what do you want?". The Judgment Calls section lists the
   decisions that are explicitly the human's to make.
5. Use the tools and MCP connectors you have. If one this document relies on is
   missing, stop and say so rather than inventing the content.
6. Push back if something here is genuinely wrong (a contradiction, an
   impossible constraint, a missing piece that blocks progress).

## What we are building

<Two to five short paragraphs. The product in plain language: who uses it, the
one core loop they repeat, why it exists. State what it is NOT, to kill obvious
wrong turns early.>

## Who this is for

<Audience, their context, the timeline or stakes. One paragraph.>

## Hard constraints

<Non-negotiable decisions. Each version here was verified in Phase 2 research,
not recalled from memory. Use "do NOT use X; use Y" phrasing for the traps you
already know about.>

- Language / runtime: <...>
- Framework: <...> (current stable: <version verified via context7>)
- Package manager: <...>
- Data layer: <...>
- Deploy target: <...>
- <Any other locked choices>

## Architecture overview

<The shape of the system: the main modules or packages and their boundaries, the
core data model, how the pieces talk. A directory tree if it clarifies. Keep it
at the level of "what and why", not line-by-line code.>

## Reference UX / design direction

<If there is a product to copy the shape of, name it and say "copy this, do not
reinvent it". If aesthetics matter, give concrete direction (typography,
palette, spacing), not a final spec.>

## External sources to read

<If seed content exists in the user's email, drive, or an existing app, name
exactly where and what to pull, and where it lands in the repo (for example
`docs/seed/`). Say what to do if a connector is missing.>

## Phases

This primer is executed in phases. Stop at the gate at the end of each phase
before the build phases begin.

1. Research: confirm current versions via context7, pull any seed content,
   record findings in `docs/research.md`.
2. Plan: write the schema / core data model in `docs/schema.md` (or inline) and
   resolve open architecture questions.
3. Decompose: write `docs/init.md` and `docs/init/NN-slug.md` task files, each
   with `deps`, `touches`, an acceptance criterion, and an acceptance command.
   STOP HERE. Present the plan for review.
4. Build: run `scripts/primer-build.workflow.js` (or `primer-exec` for a
   sequential build). Tasks run in dependency order,
   parallel where their file surfaces are disjoint, with verification gates and
   marker commits per task.
5. Review: stop before the final polish phase and hand back for human review.

## Judgment calls

<The decisions that are explicitly the human's, with a proposed answer for each.
These are the things you surface during the interview and any that surfaced
during research. Do not guess these in code.>

- <Decision>: proposed <answer>, because <reason>.

## CLAUDE.md

The first task must create `CLAUDE.md` at the repo root: project overview,
architecture, dependency graph, build and test commands, stack, conventions,
what not to do. Every later task invocation reads it automatically. Later tasks
append to it as they establish new patterns; that is how context flows between
isolated task invocations.

## What not to do

- <Scope exclusions and anti-patterns. The traps specific to this project: the
  deprecated package not to use, the abstraction not to build yet, the feature
  explicitly deferred.>
```

## Notes on writing a good primer

- The "Your job" preamble is what makes a primer act like a primer rather than a
  spec. Keep it.
- Hard constraints should be genuinely hard. If a choice is open, it belongs in
  Judgment Calls, not Hard Constraints.
- The primer should not enumerate every task. The decomposing session has better
  information after research than the primer author did. Describe the phases and
  the shape; let the breakdown be owned downstream.
- No em dashes or en dashes anywhere.
