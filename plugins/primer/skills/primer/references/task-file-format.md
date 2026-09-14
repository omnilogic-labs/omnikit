# Task file format

The primer is decomposed into `docs/init.md` (the index and global rules) and a
set of `docs/init/NN-slug.md` files (one per task). The build runner consumes
these, so the frontmatter and structure below are a contract, not a suggestion.

## docs/init.md

The index. Contains:

- A one-line description of the project and a pointer back to `primer.md`.
- The ordered list of task files with a one-line summary each.
- A "Rules that apply to every task" section: the hard stack constraints, the
  style rules (no em or en dashes, no filler phrases), the always-latest rule
  (look up versions and docs via context7; never pin from memory), and the four
  verification gates the runner applies after each task:
  1. `git status --porcelain` is empty (the task committed its own work).
  2. The build command exits 0 (for example `npm run build`).
  3. The task's acceptance command exits 0.
  4. The typecheck exits 0 (for example `npx tsc --noEmit`).
- The commit convention: short imperative subject scoped to the task. The runner
  mints the `[task-complete] NN-slug` marker; the task does not mint it itself.

## docs/init/NN-slug.md

`NN` is a zero-padded number that orders the file on disk (`01`, `02`, ... and
`100+` once you pass 99). `slug` is kebab-case. The slug after the number is the
task's identity in dependency lists and marker commits.

### Frontmatter

```yaml
---
deps: [01-repo-init]                      # slugs (with or without NN) that must land first; [] if none
touches: [src/db/**, drizzle/**]          # the file globs this task creates or edits
acceptance: "npx tsc --noEmit && npm run build"   # the command that proves the task is done
parallelizable: true                       # optional; default true. false pins it to run alone in its level
---
```

- **`deps`** is the dependency edge set. It drives the topological levels. A task
  runs only after every task in its `deps` has a completion marker.
- **`touches`** is the declared file surface. Two tasks in the same dependency
  level whose `touches` globs do not overlap are safe to run in parallel. Be
  honest and slightly generous here: an undeclared write is what causes a merge
  conflict at integration. If a task touches shared cross-cutting files (root
  config, `CLAUDE.md`, a shared types file), list them, which will correctly
  serialize it against its siblings.
- **`acceptance`** is a single shell command (it may be a `&&` chain) that exits
  0 only when the task is genuinely complete. Keep it specific to this task, not
  a full suite.
- **`parallelizable: false`** is the escape hatch for a task that is technically
  disjoint by globs but still must run alone (for example a migration that locks
  the schema, or a task that runs a global codemod).

### Body

````markdown
# NN: Human readable title

## Goal

<One paragraph: what this task builds and why, in the context of the primer.>

## What to do

<Concrete steps or requirements. Name the files to create or edit. Reference the
patterns established by prior tasks (which are in CLAUDE.md by now).>

## Acceptance

<The single concrete criterion in prose, then the command in a fenced block. The
runner extracts the command from frontmatter; this block is for the human and as
a backstop.>

```bash
npx tsc --noEmit && npm run build
````

## Notes

<Anything the executing agent needs: gotchas, links to docs to pull via context7,
what NOT to touch.>

```

## Granularity guidance

- One task should be completable in a single agent invocation but produce a
  meaningful, testable unit. "Scaffold the whole app" is too big; "add one
  import" is too small.
- Prefer many small disjoint tasks in a level over one large task. Disjoint
  tasks parallelize; large tasks serialize and are harder to verify.
- The first task (typically `01-repo-init` or `00-...`) creates `CLAUDE.md` and
  the project skeleton. Everything depends on it, so it forms level 0 alone.
- Cross-cutting tasks (ones that append to `CLAUDE.md`, edit root config, or
  touch a shared schema) naturally serialize because their `touches` overlaps
  their siblings. That is correct, not a smell.

## Worked example: a small dependency graph

```

00-repo-init deps: [] touches: [**] (level 0, alone)
01-db-schema deps: [00-repo-init] touches: [src/db/**] (level 1)
02-design-tokens deps: [00-repo-init] touches: [src/styles/**] (level 1, parallel with 01)
03-auth deps: [01-db-schema] touches: [src/auth/**] (level 2)
04-settings-ui deps: [01-db-schema, 02-design-tokens] touches: [src/app/settings/**] (level 2, parallel with 03)

```

Level 0: `00` alone. Level 1: `01` and `02` in parallel (disjoint touches).
Level 2: `03` and `04` in parallel (disjoint touches). Three barriers, five
tasks, two of the three levels fan out.
```
