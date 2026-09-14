---
name: primer
description: >-
  Turn a vague or poorly defined product idea into a primer build-brief, then
  decompose it into idempotent task files and execute the build. Use when the
  user has a fuzzy concept ("a sales app that helps you rehearse interactions
  with people", "some tool for tracking my reading") and wants it turned into a
  buildable plan, or when they say "make a primer", "write a primer document",
  "bootstrap a project from this idea", "scaffold this app", "decompose this into
  tasks", or "run the build". Produces primer.md, docs/init/ task files, and a
  dynamic Workflow build runner (with a legacy run-tasks.sh fallback).
---

# primer

Takes a vague idea and produces three things, in order:

1. **`primer.md`** at the target repo root: a single self-contained build-brief
   that another Claude Code session can read end to end and act on.
2. **`docs/init.md` + `docs/init/NN-slug.md`** task files: the primer decomposed
   into small, idempotent, independently verifiable units of work.
3. **A build run**: by default a dynamic Workflow
   (`scripts/primer-build.workflow.js`) that executes the task files, running
   independent tasks in parallel where it is safe and applying verification
   gates. For sequential builds it uses the vendored `primer-exec` runner that
   ships with this skill. Both replace the older hand-written `claude -p` loops.

This is a prompt-only skill. There is nothing to install. You drive it by
reading the reference files below and producing documents in the target repo.

## When to use it

- The user describes a product or tool in one or two fuzzy sentences and wants
  it made concrete and buildable.
- The user already has a primer and wants it decomposed and built.
- The user wants the build run as a dynamic Workflow rather than a bash loop.

Do not use it for a small, well-specified code change; that is a normal edit.
A primer is for bootstrapping a whole project or a large self-contained feature.

## The pipeline

Run these phases in order. Stop at the gates. Do not race ahead to building.

### Phase 1: Interview

The opening idea is deliberately underspecified. Resolve the decisions that
change the shape of the build before writing anything. Ask a small batch of
targeted questions with a recommended answer attached to each, using
`AskUserQuestion`. Do not ask open-ended "what do you want?" questions.

The minimum you need pinned down: who it is for and the one core loop they
repeat; platform (web / mobile / desktop / CLI); any hard stack constraints the
user already has; what is explicitly out of scope for the first build; and what
"good enough to iterate on" looks like. See `references/interview.md` for the
question playbook and how to phrase proposed-answer questions.

Capture anything the user defers as a **Judgment Call** to record in the primer,
not a guess to bury in code.

### Phase 2: Research

First settle the stack, then verify it against current reality. Never pin a
library version from memory.

- **Resolve the stack** in this order: (1) a stack the user stated in the
  conversation or interview, (2) a user stack profile at
  `~/.claude/primer/stack.md` if it exists, (3) the shipped default in
  `references/default-stack.md`. Present the chosen stack as a Judgment Call the
  user can override. The default is kept in its own file so users can replace it
  wholesale with their house stack without touching the skill.
- Use the **context7 MCP** to pull current docs and confirm the latest stable
  version of every framework and library you intend to name as a hard
  constraint. Search for the tool with ToolSearch if context7 is not already
  loaded. The stack files fix the choices, not the versions; always re-verify
  versions here.
- If the idea references existing material the user has (emails, drive
  documents, an existing app), pull it through whatever MCP connectors are
  attached and record what you found. If a connector you need is missing, stop
  and say so rather than inventing the content.
- Record findings as you go. They become the "hard constraints" and
  "architecture" sections of the primer.

### Phase 3: Author the primer

Write `primer.md` at the target repo root using the skeleton in
`references/primer-template.md`. The primer must be self-contained: a fresh
session with only this file and the repo should understand what to build, the
non-negotiable constraints, the architecture, the phases, and what not to do.

Then **stop and present it for review.** A primer is a proposal, not a mandate.
Tell the user it is ready, surface the Judgment Calls, and let them push back
before you decompose. Do not start building.

### Phase 4: Decompose into task files

After the primer is approved, generate:

- `docs/init.md`: the index plus the global rules that apply to every task
  (stack constraints, style rules, the verification gates, commit conventions).
- `docs/init/NN-slug.md`: one file per task. Each task is small enough for a
  single agent invocation, large enough to be a meaningful testable unit, and
  has exactly one concrete acceptance criterion plus an acceptance command.

Each task file carries YAML frontmatter the build runner consumes:

```yaml
---
deps: [01-repo-init, 02-drizzle-schema]   # task slugs that must land first
touches: [src/db/**, drizzle/**]          # declared file surface of this task
acceptance: "npx tsc --noEmit && npm run build"
---
```

`deps` drives ordering. `touches` is how the runner decides what is safe to run
in parallel: two tasks with disjoint `touches` globs in the same dependency
level can run concurrently. Full format in `references/task-file-format.md`.

The first task must create `CLAUDE.md` at the repo root with shared project
context, because every later task invocation reads it automatically.

### Phase 5: Run the build

Generate `scripts/primer-build.workflow.js` from the template in
`references/build-workflow.md` and run it with the **Workflow tool**. The user
invoking this skill and asking to build is the explicit opt-in the Workflow tool
requires. The workflow:

- spawns a plan agent that reads `docs/init/` and `git log` and returns the task
  list, the `deps`/`touches` graph, and which `[task-complete] NN-slug` markers
  already exist (those are skipped);
- computes dependency levels in plain JS, splits each level into parallel groups
  by disjoint `touches`;
- runs each parallel group with `parallel()` of worktree-isolated agents, then
  an integration agent lands the worktrees, re-runs the gates, mints the marker
  commits, and appends shared context to `CLAUDE.md` at the level barrier;
- falls back to sequential and stops for review on a gate failure or merge
  conflict.

If the Workflow tool is unavailable, or the build is strictly sequential and the
user prefers a plain CLI, use the vendored **`primer-exec`** runner instead. It
ships with this skill at `bin/primer-exec.ts` (TypeScript, runs under tsx or
bun), is dependency-ordered, applies the same four gates, and mints the same
markers. Do not generate a fresh `run-tasks.ts`/`run-tasks.sh` into the target
repo; run the vendored one against the repo's `docs/init/`. See
`references/primer-exec.md`.

## claude -p versus the dynamic workflow

The older convention ran one isolated `claude -p` per task from a bash loop, used
git commit markers for idempotency, and applied gates inline in the shell. The
dynamic Workflow reproduces all of that and adds parallel task groups, structured
gate results, a budget ceiling, in-session resume, and a live progress view.

The one real boundary: a Workflow script is pure JS with no shell, git, or
filesystem access. So reading task files and running gates (`npm run build`,
`tsc`, `git status`, the marker commit) must be done by subagents that return
structured results, not by the orchestrator inline. That delegation is built
into the template.

Be honest about the payoff: for a strictly sequential dependent build the
workflow is mostly a nicer orchestrator than the bash loop. The real win shows
up with parallel-safe task groups, fan-out research, and per-task verification.

## Conventions

- No em dashes or en dashes. Use commas, periods, colons, semicolons, or
  parentheses.
- The primer and task files name current verified versions, never versions
  recalled from memory.
- Every task ends in a commit; the build is resumable because completed tasks
  carry a `[task-complete] NN-slug` marker that the runner skips.
