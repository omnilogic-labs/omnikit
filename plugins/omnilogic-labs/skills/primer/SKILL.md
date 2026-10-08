---
name: primer
description: >-
  Turn a vague product idea into a primer.md build-brief, decompose it into idempotent task files under docs/init/, and run the primer build. Use for fuzzy concepts, "make a primer", "bootstrap a project from this idea", "decompose into tasks", "run the primer build".
---

# primer

Takes a vague idea and produces three things, in order:

1. **`primer.md`** at the target repo root: a self-contained build-brief that a
   fresh agent session can read end to end and act on.
2. **`docs/init.md` and `docs/init/NN-slug.md`** task files: the primer
   decomposed into small, idempotent, independently verifiable units.
3. **A build run** that executes the task files in dependency order, running
   independent tasks in parallel where it is safe, with verification gates.

This is a prompt-only skill. Nothing to install; you produce documents in the
target repo by following the references below.

## When to use it

- The user describes a product in one or two fuzzy sentences and wants it made
  concrete and buildable.
- The user already has a primer and wants it decomposed and built.

Do not use it for a small, well-specified code change. A primer is for
bootstrapping a whole project or a large self-contained feature.

## The pipeline

Run the phases in order. Stop at the gates. Do not race ahead to building.

### Phase 1: Interview

The opening idea is deliberately underspecified. Resolve the decisions that
change the shape of the build before writing anything. Ask a small batch of
targeted questions, each with a recommended answer attached. Do not ask
open-ended "what do you want?" questions.

Pin down: who it is for and the one core loop they repeat; platform (web,
mobile, desktop, CLI); hard stack constraints; what is out of scope for the
first build; what "good enough to iterate on" looks like. Question playbook:
`references/interview.md`.

Record anything the user defers as a **Judgment Call** in the primer, not a
guess buried in code.

### Phase 2: Research

Settle the stack, then verify it against current reality. Never pin a library
version from memory.

- **Resolve the stack** in this order: (1) a stack the user stated, (2) a user
  stack profile at `~/.agents/primer/stack.md` (or `~/.claude/primer/stack.md` if that is the one that exists), (3) the shipped
  default in `references/default-stack.md`. Present the chosen stack as a
  Judgment Call the user can override.
- Use current documentation (the context7 MCP or the `ctx7` CLI, whichever the
  host has) to confirm the latest stable version of every framework and library
  named as a hard constraint. The stack files fix the choices, not the versions.
- If the idea references existing material (emails, drive documents, an
  existing app), pull it through whatever connectors are attached and record
  what you found. If a needed connector is missing, stop and say so rather than
  inventing the content.
- Record findings as you go. They become the "hard constraints" and
  "architecture" sections of the primer.

### Phase 3: Author the primer

Write `primer.md` at the target repo root using `references/primer-template.md`.
A fresh session with only this file and the repo must understand what to build,
the non-negotiable constraints, the architecture, the phases, and what not to do.

Then **stop and present it for review.** A primer is a proposal. Surface the
Judgment Calls and let the user push back before you decompose.

### Phase 4: Decompose into task files

After the primer is approved, generate `docs/init.md` (the index plus global
rules: stack constraints, style rules, verification gates, commit conventions)
and one `docs/init/NN-slug.md` per task. Each task is small enough for one agent
invocation, large enough to be a testable unit, and has exactly one acceptance
criterion plus an acceptance command. Frontmatter the runner reads:

```yaml
---
deps: [01-repo-init, 02-drizzle-schema]   # task slugs that must land first
touches: [src/db/**, drizzle/**]          # declared file surface of this task
acceptance: "bunx tsc --noEmit && bun run build"
---
```

`deps` drives ordering. Two tasks in the same dependency level with disjoint
`touches` globs can run concurrently. Full format:
`references/task-file-format.md`.

The first task creates `AGENTS.md` at the repo root with shared project context,
plus a `CLAUDE.md` containing `@AGENTS.md`, because every later task invocation
reads it.

### Phase 5: Run the build

Pick the runner by host:

- **Portable default: `primer-exec`**, a TypeScript runner vendored at
  `bin/primer-exec.ts` (runs under tsx or bun). It is sequential and
  dependency-ordered, applies four gates, and mints a `[task-complete] NN-slug`
  commit marker per task. Run it against the repo's `docs/init/`; do not
  generate a fresh `run-tasks` script into the target repo. See
  `references/primer-exec.md`.
- **Parallel build on Claude Code**: a generated workflow script that fans
  independent task groups out to isolated worktrees, then lands them, re-runs the
  gates and mints markers at each level barrier. Requires the user to ask for the
  build explicitly. See `references/build-workflow.md`.

Either way, every task ends in a commit and the build is resumable: completed
tasks carry a `[task-complete] NN-slug` marker that the runner skips. On a gate
failure or merge conflict, stop for human review.

## Conventions

- No em dashes or en dashes. Use commas, periods, colons, semicolons, or
  parentheses.
- Use `bun` in examples and commands unless the project's stack says otherwise.
- The primer and task files name current verified versions, never versions
  recalled from memory.
