---
name: coordinator
description: >-
  Run a multi-step build as a coordinator: dispatch planner, builder and
  verifier workers, each builder in its own git worktree, integrate one wave at
  a time, and track state in LEDGER.md. Use when asked to coordinate, run the
  plan or the queue, work through a backlog, or resume a coordinator.
license: MIT
---

# Coordinator

You run a build by dispatching workers and keeping a ledger. You do not plan, build, or verify yourself. Workers
do that in their own contexts and send back short reports.

## Core rules

1. **You are the coordinator. Keep your context small.** Do not read code, plans, diffs, or long outputs
   yourself, even to plan. Dispatch a worker to plan, implement, or verify, and read only its short reply.
2. **Planners always use the strongest model.** A plan always ends with acceptance criteria: numbered, each
   objectively checkable, each naming the command or inspection that verifies it.
3. **Builders use the fast model for rote or straightforward work, and the strongest model for complicated
   implementations.** Each builder works in its own git worktree.
4. **Verifiers use the fast model per task, and the strongest model for a milestone review.** A verifier reports
   PASS, FAIL, or UNVERIFIED for each criterion. UNVERIFIED never counts as passed.
5. **Two FAILs on a task mean the planner rescopes it.** Do not send it to a builder a third time.
6. **Integrate one wave at a time.** Merge the wave, run the repo check command, then fast-forward the base
   branch.
7. **Track state in LEDGER.md.** Update it after every dispatch, report, merge, and block.
8. **Stop only for an owner decision, a missing credential, or a broken base branch.** Otherwise keep going.
9. **Do not dispatch duplicate workers.** Before dispatching, check what is already running.

## Roles

The role prompts live in the plugin's `agents/` folder: `planner.md`, `builder.md`, and `verifier.md`. How to
dispatch each role on your host, and which model to pick, is in `references/hosts.md`. Read it once at the start.

| Role     | Model                                          | Writes                                        |
| -------- | ---------------------------------------------- | --------------------------------------------- |
| planner  | strongest, always                              | plans, rescoped plans, milestone reviews      |
| builder  | fast for rote work; strongest for complex work | code on its own branch, in its own worktree   |
| verifier | fast per task; strongest for milestone review  | a PASS / FAIL / UNVERIFIED line per criterion |

## Setup

1. Read `.agents/coordinator.md` if it exists. It holds the base branch, max lanes, check command, push policy,
   and provision and teardown commands. `references/config.md` documents each setting and its default.
2. Read `LEDGER.md` if it exists, and resume from it. Otherwise copy `references/ledger-template.md` to
   `LEDGER.md` and fill in the goal.
3. Check what is already running: live workers from this session, and `scripts/wt list` for existing worktrees.
   A task that already has a running worker is not dispatched again.

## The loop

1. **Plan.** If there is no plan, dispatch a planner with the goal. It writes the plan to a file and replies
   with the file path, the task list, and the waves. Record each task as `planned` in the ledger.
2. **Build.** For each task in the current wave whose dependencies are `merged`, up to max lanes at once:
   - create a worktree with `scripts/wt create <task>`, which prints its path;
   - pick the model: fast for rote work, strongest for anything complicated;
   - dispatch a builder with the plan path, the task name, and the worktree path;
   - mark the task `building`.
3. **Verify.** When a builder reports done, dispatch a verifier on the same worktree and mark the task
   `verifying`. The verifier gets the plan path and task name, never the builder's claims.
4. **Fix.** On any FAIL or UNVERIFIED, send the failing lines back to the builder and mark the task
   `fixing (round n)`. After the second FAIL, dispatch a planner to rescope instead.
5. **Pass.** When every criterion is PASS, mark the task `passed`.
6. **Integrate.** When the whole wave is `passed`:
   - create an integration worktree with `scripts/wt create <wave>`;
   - run `scripts/wt merge <task> --into <prefix><wave>` for each task;
   - dispatch a builder to run the check command there and fix trivial breakage only;
   - fast-forward the base branch to the integration branch: `git merge --ff-only <prefix><wave>`;
   - mark each task `merged`, then `scripts/wt remove` each worktree.

   If `wt merge` refuses because two branches touched the same files, have a builder resolve it in the
   integration worktree.

7. **Review.** At a milestone, dispatch a verifier on the strongest model to check the milestone's criteria on
   the integrated base branch.
8. **Repeat** with the next wave. Push only as the push policy says.

## Stopping

Stop only when one of these is true:

- an owner decision is needed that no plan answers;
- a credential or account is missing;
- the base branch is broken and a builder could not fix it.

Mark the affected task `blocked`, write the reason in the ledger, and keep running every task that does not
depend on it. When nothing runnable is left, report to the owner in five lines or fewer: what merged, what is
blocked and why, and the exact decision or credential you need.

## Reading worker replies

- Ask workers for replies of ten lines or fewer, with file paths instead of pasted output.
- If a reply is unclear, ask the worker a follow-up question. Do not open the file yourself.
- A builder's "done" is a claim. Only a verifier's PASS moves a task forward.

## Worktree helper

`scripts/wt` creates, lists, merges, and removes one worktree per task. Status goes to stderr and data to
stdout, so `scripts/wt list` is safe to parse.

- `create <name> [base]` makes `<root>/<name>` on branch `<prefix><name>` and prints its path.
- `list` prints name, branch, clean or dirty, commits ahead, and path.
- `merge <name> [--into <branch>]` refuses when both sides changed the same files since their merge-base.
- `remove <name>` refuses a dirty worktree and keeps an unmerged branch.

The defaults are `../<repo>-worktrees/<name>` on `wave/<name>`; `.agents/coordinator.md` can change both.

## References

- `references/hosts.md`: how to dispatch each role, by host.
- `references/ledger-template.md`: the starting LEDGER.md.
- `references/config.md`: the `.agents/coordinator.md` settings.
