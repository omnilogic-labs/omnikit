# Example adapter

A filled-in `.claude/night-shift.md`, from the repo this package was decomposed from. Copy the shape, replace every value, delete what does not apply. `references/adapter.md` is the spec; this is what one looks like in use.

The body rulings are that project's too, not the package's — "Bun only", "Postgres only", a single-process `start`, autodeploy on `main`. Yours will say different things. What transfers is the _kind_ of thing an adapter body settles: what the toolchain is, what the data is, what a push means, and what an agent may decide alone.

It shows the **wrapped-submodule layout**: the adapter lives in an outer planning repo, the repo actually being built is that repo's `platform/` submodule, and the hook scripts sit in the outer repo and target the inner one from outside. The built repo carries its own `AGENTS.md`, which every dispatched agent reads at the worktree root.

Two things in it are worth copying deliberately rather than by accident:

- **`priority_order` leads with `missing-surface`, not with severity.** A severity sort buries delivery work: an absent feature files no bug reports, so it never looks urgent, so it sinks below every real-but-minor defect. `bug_budget` then caps how much of the queue goes to defects at all.
- **Every hook path is absolute**, via a variable the orchestrator resolves at run start. The Bash tool's working directory persists across calls, so a relative hook path works only while the run happens to be sitting in the repo root, and dies the first time a lane `cd`s elsewhere.

The inline demo passwords are seed fixtures for a per-worktree throwaway database, already published in the built repo's README — the case the adapter spec's credential rule allows as a literal value. Anything outliving the run would be a `password_ref`. The prose keeps the consuming repo's house punctuation, because an adapter is written in that repo's voice, not this package's.

---

```markdown
---
repo: acme/product-platform
base_branch: main
push_policy: after-each
concurrency_cap: 3
priority_order: [missing-surface, blocking, feature, bug]
bug_budget: 0.33
plan_dir: ${PLANNING_ROOT}/docs/cleanup-plan

hooks:
  preflight: bash ${PLANNING_ROOT}/.claude/grind/preflight.sh
  provision: bash ${PLANNING_ROOT}/.claude/grind/wt.sh new
  teardown: bash ${PLANNING_ROOT}/.claude/grind/wt.sh remove
  integrate: bash ${PLANNING_ROOT}/.claude/grind/wt.sh integrate
  typecheck: bun x tsc -b
  build: bun run build
  seed: bun run seed
  start: bun run start

overrides:
  scout: { model: sonnet }

references:
  - ${PLANNING_ROOT}/legacy-app-one
  - ${PLANNING_ROOT}/legacy-app-two
  - ${PLANNING_ROOT}/docs/product-truth.md
prior_art: true
design_reference: ${PLANNING_ROOT}/docs/design-system.md

test_accounts:
  - role: staff
    user: staff@acme.example
    password: demo!
  - role: org-admin
    user: admin@customer.example
    password: demo!
---

## Two repos, and which one the pipeline runs in

This adapter lives in the outer **planning** repo, not the repo being built. Every
branch, commit and push belongs to the `platform/` submodule. The only change that
legitimately lands in the outer repo is an edit to this harness.

`${PLANNING_ROOT}` is this repo's absolute path. The orchestrator resolves it once at
run start and passes it to agents as a value. Never hardcode it, and never use
`$CLAUDE_PROJECT_DIR` in its place — the harness injects that only for `settings.json`
hooks and it is unset in ordinary Bash calls.

## What to build first

`priority_order` and `bug_budget` bind the queue, not just the intent. Read the disk
before the board: only the filesystem says what has been built, and a surface that does
not exist outranks every improvement to one that does. A defect filed as a missing
feature is still a defect.

## Hook behavior worth knowing

`preflight` reports and **exits 0 even on warnings**, on purpose, so the orchestrator
reads the report and decides.

`provision` does **not** start the server and reports `SERVER=not-started`. It writes
`PORT`, `APP_URL` and `DATABASE_URL` into each worktree's `.env`, so a lane is isolated
even if an agent forgets to pass them. Agents start the app themselves and kill it by
PID, never by name.

`integrate` exits 3 on conflict and prints the conflicting files plus the exact commit
message to use. It derives `Closes #<n>` from the branch name, so pass an ordinary
conventional subject and let the hook add the trailer. Never amend to fix a trailer.

`teardown` refuses while a worktree is dirty or in use (exit 4) — a signal an agent is
still working in there, not an error to force past.

## Toolchain and data

Bun only. `start` is single-process and serves the SPA and API on one port; never use
the two-process dev server in a worktree, its proxy points at a hardcoded port and
parallel lanes collide.

Postgres only. Schema is idempotent SQL applied at boot; `seed` is safe to re-run. Each
worktree gets its own throwaway database. A lane that cannot reach its database has an
environment problem to report, never evidence the feature is broken.

## Prior art

The platform consolidates existing apps whose product decisions are already made. Read
the reference implementation and take its current behavior as the baseline. The
reference apps are the **parity floor, not a menu**. Diverging is recorded as
`INTENTIONAL_DIVERGENCE`; a gap the reference does not cover as `NO_REFERENCE_FOUND`.
Both surface in the return, because divergence is the user's call. The only
prohibitions are copying reference code and connecting to reference databases.

## Ground rules live in the built repo

The built repo's own `AGENTS.md` is authoritative; every dispatched agent reads it at
the worktree root. One rule worth repeating because the verifier acts on it: any UI
change is graded in **both light and dark themes**.

Pre-production, so no backwards-compatibility constraint: replace legacy shapes
outright rather than shimming them, and front-load risky schema and infra work rather
than concentrating it at cutover.

## Voice

Narrative, anti-hype, concrete. No emojis. Commits are conventional and reference their
issue.

## Deploying and escalation

Hosting autodeploys on a `main` push, so **a push is a deploy**, which is why
`push_policy` is `after-each`. There are no users and no live data: never stop to ask
whether it is acceptable to push, migrate, or drop something. Never push mid-conflict,
push only clean built state, stop and surface it if a deploy breaks.

Route to `HOLD` and wait for explicit approval only for what touches the world outside
this repo: real-data migrations, DNS, decommissioning, handover.

Otherwise decide it yourself when prior art or the code answers it. Ask once, on the
ticket, with a recommendation, marked as automated — and only when guessing risks a
wrong product decision.
```
