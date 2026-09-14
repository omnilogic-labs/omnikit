# primer

Turn a vague product idea into a buildable plan, then build it.

The `primer` skill takes a fuzzy prompt ("a sales app that helps you rehearse
interactions with people") and walks it through five phases: interview the user
to pin down the few decisions that shape the build, research the stack against
current reality, author a self-contained `primer.md` build-brief, decompose it
into idempotent `docs/init/NN-slug.md` task files, and run the build.

This is a prompt-only skill. There is nothing to install. The skill is the
`SKILL.md` instructions plus the reference docs and one vendored runner under
`skills/primer/`.

## What a primer is

A primer is a convention for bootstrapping a project with Claude Code: one
Markdown file a fresh session reads end to end, decomposes into small verifiable
tasks, and executes idempotently, with each completed task recorded as a git
commit marker so the build is resumable. This skill packages that convention so
it does not have to be hand-rebuilt per project.

## The two runners

The skill produces task files that both runners consume (each task declares
`deps`, `touches`, and an `acceptance` command in frontmatter):

- **Dynamic Workflow (default):** a generated `primer-build.workflow.js` run via
  the Workflow tool. Runs independent task groups in parallel in isolated
  worktrees, with an integration agent per dependency level that lands the work,
  re-runs the gates, and mints markers. Best when tasks can fan out.
- **`primer-exec` (vendored, sequential):** a single TypeScript runner shipped at
  `skills/primer/bin/primer-exec.ts`, run under tsx or bun. Dependency-ordered,
  four verification gates (clean tree, build, acceptance, typecheck), idempotent
  markers, a correct idle/post-result watchdog, and clean Ctrl-C handling. Use
  it for strictly sequential builds or when the Workflow tool is unavailable.

### Can a dynamic workflow do what run-tasks.sh did?

Yes. Every behavior of the old `run-tasks.sh`/`run-tasks.ts` scripts maps onto
Workflow primitives: the task loop becomes a `for`/`pipeline`, each isolated
`claude -p` becomes an `agent()`, resume comes from git markers plus
`resumeFromRunId`, parallelism comes from `parallel()` and worktree isolation,
and gate results come back structured via a schema. The one boundary is that a
Workflow script is pure JS with no shell, git, or filesystem access, so reading
task files and running gates is delegated to subagents that return structured
results rather than run inline. For a strictly sequential build the workflow is
mostly a nicer orchestrator; the real win is parallel-safe task groups and
per-task verification. The vendored `primer-exec` covers the sequential case as
a plain CLI.

`primer-exec` is the distilled, corrected successor to the many bespoke
`run-tasks` scripts across the user's projects; the specific bugs it fixes
(watchdog hangs, log double-writes, Ctrl-C not stopping the run, vacuous
acceptance gates, false completions, `git add -A` attribution, sort breaking
past 99 tasks) are documented in `skills/primer/references/primer-exec.md`.

## Layout

```
skills/primer/
  SKILL.md                     the five-phase pipeline
  bin/primer-exec.ts           the vendored sequential runner
  references/
    interview.md               clarifying-question playbook
    default-stack.md           the opinionated default stack, overridable
    primer-template.md         the primer.md skeleton
    task-file-format.md        docs/init.md and NN-slug.md format
    build-workflow.md          the dynamic Workflow build template
    primer-exec.md             primer-exec usage and the bugs it fixes
```

By Omnilogic Labs.
