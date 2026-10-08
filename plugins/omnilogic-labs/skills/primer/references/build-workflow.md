# The dynamic build workflow

This is the default runner. It is a JavaScript Workflow script, generated into
the target repo as `scripts/primer-build.workflow.js` and run with the **Workflow
tool**. The user invoking this skill and asking to build is the explicit opt-in
the Workflow tool requires.

For a strictly sequential build, or when the Workflow tool is not available, use
the vendored `primer-exec` runner instead (see `references/primer-exec.md`).

## What the workflow must do

1. **Plan (one agent).** The orchestrator JS cannot read files or run git, so a
   single agent reads `docs/init/`, parses each task's `deps`/`touches`/
   `acceptance` frontmatter, reads `git log` for existing `[task-complete] NN-slug`
   markers, and returns it all as structured JSON. Completed tasks are dropped.
2. **Level computation (plain JS).** Topologically sort the remaining tasks by
   `deps` into levels. Within a level, group tasks whose `touches` globs are
   disjoint into parallel groups; a task with `parallelizable: false` or an
   overlapping surface runs alone.
3. **Execute level by level (barrier between levels).** Each parallel group runs
   as `parallel()` of worktree-isolated agents. Then one integration agent lands
   the worktrees onto the build branch, re-runs the gates, mints the markers, and
   appends shared context to `CLAUDE.md`.
4. **Fail safe.** On a gate failure or merge conflict, log it and stop for human
   review (or re-run the single offending task sequentially).

## Why an integration agent

Parallel agents each work in their own worktree off the same base, so they
cannot see each other's commits or each other's `CLAUDE.md` edits. The
integration agent is the barrier where the level's work is serialized back
together: it lands each worktree in turn, runs the four gates once on the
combined tree, writes the marker commits, and makes the level's new shared
context visible to the next level by appending to `CLAUDE.md`. Keep all
`CLAUDE.md` edits in the integration step, never inside the parallel task agents.

## Template

Generate a script of this shape. Adjust the schemas and the gate commands to the
project. Keep `meta` a pure literal.

```javascript
export const meta = {
  name: 'primer-build',
  description: 'Build a primer-decomposed project: dependency-ordered tasks, parallel where safe, verified gates',
  phases: [
    { title: 'Plan' },
    { title: 'Build' },
    { title: 'Integrate' },
  ],
}

const TASK_SCHEMA = {
  type: 'object',
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['slug', 'deps', 'touches', 'acceptance', 'done'],
        properties: {
          slug: { type: 'string' },
          deps: { type: 'array', items: { type: 'string' } },
          touches: { type: 'array', items: { type: 'string' } },
          acceptance: { type: 'string' },
          parallelizable: { type: 'boolean' },
          done: { type: 'boolean' },
        },
      },
    },
  },
}

const GATE_SCHEMA = {
  type: 'object',
  required: ['pass', 'failures', 'landed'],
  properties: {
    pass: { type: 'boolean' },
    landed: { type: 'array', items: { type: 'string' } },     // slugs that got a marker
    failures: { type: 'array', items: { type: 'string' } },   // human-readable gate failures
  },
}

const HARD_RULES = `You are executing one task from docs/init/. Read CLAUDE.md and docs/init.md first for project context and global rules. Then do exactly this task, run its acceptance command yourself, and commit your own work with a short imperative subject. Committing is mandatory: when the work is done you MUST \`git add -A && git commit\`. Uncommitted work cannot be landed and will be treated as a failed task. Do NOT write the [task-complete] marker; the runner does that. Look up library versions and docs via the context7 MCP; never pin from memory. No em dashes or en dashes. Do not run a long-lived foreground command (no dev server in the foreground); background it, capture the PID, check, then kill it.`

// 1. Plan
phase('Plan')
const plan = await agent(
  `Read every file in docs/init/. For each task parse its frontmatter (deps, touches, acceptance, parallelizable) and slug (the NN-slug filename without .md). Run \`git log --format=%s HEAD\` and mark a task done:true if a commit subject starts with "[task-complete] <slug>". Return the full task list.`,
  { label: 'plan', phase: 'Plan', schema: TASK_SCHEMA },
)

const pending = plan.tasks.filter((t) => !t.done)
if (pending.length === 0) {
  log('All tasks already complete.')
  return { done: true, tasks: plan.tasks.length }
}

// 2. Level computation (pure JS topological sort over `pending`)
const bySlug = new Map(pending.map((t) => [t.slug, t]))
const levels = []
const placed = new Set(plan.tasks.filter((t) => t.done).map((t) => t.slug))
let guard = 0
while (bySlug.size && guard++ < 1000) {
  const ready = [...bySlug.values()].filter((t) => t.deps.every((d) => placed.has(d)))
  if (ready.length === 0) { log('Dependency cycle or missing dep; stopping.'); break }
  levels.push(ready)
  for (const t of ready) { placed.add(t.slug); bySlug.delete(t.slug) }
}

const overlaps = (a, b) => a.some((g) => b.includes(g))   // refine to real glob overlap if needed

// 3. Execute level by level
const results = []
for (let i = 0; i < levels.length; i++) {
  const level = levels[i]
  // split the level into parallel groups by disjoint touches
  const groups = []
  for (const t of level) {
    const solo = t.parallelizable === false
    const g = solo ? null : groups.find((grp) => !grp.some((x) => overlaps(x.touches, t.touches)))
    if (g) g.push(t)
    else groups.push([t])
  }

  for (const group of groups) {
    // run the group's tasks in parallel, each in its own worktree
    await parallel(group.map((t) => () =>
      agent(`${HARD_RULES}\n\nTask file: docs/init/${t.slug}.md\nAcceptance command: ${t.acceptance}`,
        { label: `build:${t.slug}`, phase: 'Build', isolation: 'worktree' }),
    ))

    // integration barrier: land, gate, mint markers, update CLAUDE.md
    const gate = await agent(
      `Integrate the just-completed tasks [${group.map((t) => t.slug).join(', ')}] onto the build branch. ` +
      `For each task's worktree: FIRST, if it has uncommitted changes, stage and commit them (the worktree is isolated to this one task, so \`git add -A && git commit\` is safe and never loses work); a task whose worktree has no commits at all is a failure, record it in failures. THEN land its commits (cherry-pick or merge), resolve trivially or report a conflict. ` +
      `Then on the combined tree run the gates once: (1) git status --porcelain empty, (2) the project build command, ` +
      `(3) each task's acceptance command, (4) the typecheck. If all pass, write one empty commit per task with subject ` +
      `"[task-complete] <slug>", and append any new shared patterns to CLAUDE.md. Return pass, the slugs you landed, and any failures.`,
      { label: `integrate:L${i}`, phase: 'Integrate', schema: GATE_SCHEMA },
    )
    results.push(gate)
    if (!gate.pass) {
      log(`Level ${i} failed integration: ${gate.failures.join('; ')}. Stopping for review.`)
      return { done: false, stoppedAt: i, results }
    }
  }
}

return { done: true, levels: levels.length, results }
```

## Notes

- Name the generated file `scripts/primer-build.workflow.js` so it does not
  collide with any existing `*.workflow.js` or task runner in the repo.
- The `overlaps` helper above does a cheap string-equality check on globs. If
  tasks declare globs at different granularities (`src/**` vs `src/db/x.ts`),
  refine it to a real prefix or minimatch overlap test, or just declare
  `touches` consistently in the task files.
- Idempotency is durable through the git markers (re-running skips completed
  tasks across sessions) and fast through `resumeFromRunId` within a session.
- Worktree isolation is the expensive part; it is justified only because the
  parallel agents mutate files concurrently. A strictly sequential build does
  not need it and should use `primer-exec` instead.
