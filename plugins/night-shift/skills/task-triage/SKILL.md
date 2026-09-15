---
name: task-triage
description: >-
  Read a whole GitHub issue board and return a compact plan: a bucket per issue
  (BUILD, FEEDBACK, HOLD, EPIC), an ordered build queue, and disjoint clusters
  that can run in parallel. Use before starting a batch of work, when deciding
  what to work on next across many open issues, or at the start of an
  unattended run. Triggers include "triage the open issues", "what should we
  work on", "plan the board", "sort these tickets". Returns a digest, never
  issue bodies, so the caller's context stays small.
context: fork
background: false
---

# task-triage

Reads the whole board so the caller does not have to. The output is a digest: buckets, an ordered queue, and clusters. Issue bodies never come back.

This is deliberately the first action of any run. A caller that reads sixty issue bodies itself has spent its context before doing anything. On Claude Code this skill runs forked (`context: fork`), so even this procedure never enters the caller's window; the digest is the only thing that returns, and your final message must be exactly that digest.

## Inputs

- **Scope** (optional): issue numbers, a label, or a focus area. Default is everything open. Scope as invoked: "$ARGUMENTS" (empty means everything open).
- **Adapter**: `.claude/night-shift.md` in the consuming repo. Keys read here: `repo`, `priority_order`, `bug_budget`, `references`, `prior_art`, `overrides`. A missing adapter is not fatal; a missing `repo` is, since there is no board to read.

## Use a scout for the reading pass

When a subagent roster is available, dispatch `night-shift-scout` for the reading pass: hand it the issue list and the question ("bucket each of these, quote only the deciding lines"), and work from its `EXTRACT`. This is the difference between a triage costing a few thousand tokens of context and one costing fifty thousand.

**Apply the adapter's `overrides` for the scout role to this dispatch.** Triage is usually the first dispatch of a run, so it is the one most often sent at a default model while the adapter was asking for a higher one. Read `overrides` before dispatching, and log the model you used.

**Splitting the board across several scouts is normal, and `board-scan.sh` has already done the split.** Each `SLICE` line in its manifest names one file and the issues inside it; hand one path to one scout. Do not let scouts choose their own filenames: the session scratchpad is shared by every agent in the run, so five agents left to name their own output all reach for `scratchpad/issues.txt` and overwrite each other. A scout reading back a file full of issue numbers it never asked for is that collision.

**Without a subagent roster**, run the same procedure in one context, with two adjustments: read in batches and write each batch's buckets into the digest before reading the next; and drop the concurrency cap to 1 for whatever runs after, since one context cannot supervise parallel lanes. Codex installations that expose agent delegation have a roster; resolve the scout from `roles.yaml` before dispatching it.

### The scratch file is the handoff, not the scout's return value

**Never wait on a scout. Read its file.**

Scouts may be launched asynchronously, in which case the dispatching context gets back launch metadata (`Async agent launched successfully`) and nothing else, while the scout's actual report is delivered to the session that owns the run. A forked skill cannot receive that delivery. Waiting for it is waiting for a message that will never arrive.

This is why the previous section makes you name each scout's output file: that file, not the agent return, is the contract. Every scout writes its slice to the path you gave it, and you read the paths you handed out. The handoff is the filesystem.

So:

1. Dispatch every scout with its own named output path, in one batch.
2. Poll the **files**, not the agents: `wc -l <path>` over the paths you assigned tells you which slices have landed.
3. Synthesize from the files as they appear. A slice that is complete on disk is ready to bucket whether or not its agent has reported.

**Never sleep, poll on a timer, or spin a wait-loop for a subagent.** Not in any form, and specifically not these:

```bash
sleep 60                                                    # blocked in most harnesses
until [ -f /tmp/nonexistent-sentinel ]; do sleep 110; break; done   # the same sleep, laundered
while true; do sleep 30; ls scratch/; done                   # a timer wearing a condition
```

The middle form is worth naming because it is what an agent reaches for when the harness blocks bare `sleep`: a condition that is never true plus an unconditional `break` is a plain sleep with extra steps, and dressing it as a wait-loop defeats a guardrail that exists for exactly this reason. In one observed run a triage fork spent 12 of its 14 minutes in that loop, escalating the interval until it found the value just under the tool timeout, while the scout output it was waiting for sat complete on disk and the run produced no digest at all.

If every assigned file is populated and you still feel the need to wait, you are done. Synthesize and return.

## Step 1: enumerate

Run `scripts/board-scan.sh`. It is the entire fetch, and none of what it does is a judgement call:

```bash
scripts/board-scan.sh scan --repo <owner/repo> --out <scratchdir> \
  [--hold <adapter's hold range, e.g. 117-122>] [--slices <n>]
```

It fetches the board in bulk with bodies attached, buckets everything decidable from labels alone, drops issues unchanged since the last run, and writes the survivors into `issues_<lo>-<hi>.txt` slice files with their comments already inlined. Its stdout is the manifest:

```
PREFILTERED hold 6 #122,#121,...
PREFILTERED epic 15 #556,#529,...
PREFILTERED feedback 7 #554,#537,...
REUSED 3
  #534 BUILD feature roadmap off real Spark exercises
TO_READ 75
SLICE <path> 521,525,526,...
```

`PREFILTERED` and `REUSED` are already bucketed and carry into the digest as they stand. **`TO_READ` is the only set that costs anything**, and the `SLICE` lines are the paths to hand out in Step 2, one per scout. On a 106 issue board this took 28 issues off the reading list before a scout was dispatched, and the cache takes off however many have not moved since the last run.

When the scan finishes, close the loop so the next run is cheaper:

```bash
printf '%s\n' "$DIGEST_BUCKET_LINES" | scripts/board-scan.sh record --out <scratchdir>
```

Honor the scope argument by filtering the manifest, not by re-fetching.

**Other tracker calls**, which stay manual:

```bash
gh -R <repo> issue list --state open --label <label> --json number,title,labels  # scoped
gh -R <repo> issue comment <n> --body-file <file>                                # hygiene, once
```

To swap trackers, rewrite `board-scan.sh` and this block; nothing downstream knows where the issues came from.

**An empty read is a failed fetch, never an empty ticket.** The script fetches in bulk and counts its own pages, which is most of this hazard handled, but if a slice file is short against the numbers the manifest assigned it, re-fetch before bucketing. A blank body silently bucketed is a ticket triaged on no evidence at all.

## Step 2: read the body and the comments together

The slice files from Step 1 already hold each issue's body and comments together. That pairing is the point:

**Hard rule: read each issue's body and its comments as one unit.** The body is the spec; comments amend it with decisions, approvals, answers, reversals. Miss a comment and you rebuild decided work, treat unblocked work as blocked, or re-ask an answered question. Ignore the body and you build a ghost of the real ask.

**Comment count is not a staleness signal.** What makes a body stale is something outside the ticket: code already on disk that implements or supersedes it, a superseding issue or epic, a decision recorded in a meeting or contract, or prior art that already defines the behavior. Judge against those, not against the thread.

## Step 3: bucket

Sort every issue into exactly one bucket:

- **`BUILD`**: a clear, self-contained change needing no stakeholder decision. These feed the pipeline.
- **`FEEDBACK`**: needs a product decision, is a spec reconciliation, or asks a question. Do not implement.
- **`HOLD`**: destructive, outward-facing, or hard to reverse (data migrations, DNS, deploys, anything touching real users). Write the runbook and the decisions needed, then wait for explicit approval.
- **`EPIC`**: tracking only. Note which children it covers.

**Before filing anything as `FEEDBACK`, check whether prior art already answers the question.** Most "design questions" are already answered by an existing implementation whose behavior is the baseline. If the reference answers it, it is a `BUILD` starting from that baseline. Escalate only what the references and docs genuinely do not answer.

Default to acting: most tickets can be done well from prior art plus the code. Ask when guessing risks meaningful rework, a wrong product decision, an irreversible action, or a data-integrity mistake.

### Classify by what the code does, not by how the ticket sounds

A ticket's wording is written by whoever was annoyed at the time, and it is the least reliable input you have. **Check the disk before assigning a category.**

**Check it once, for the bucket, and stop.** One grep to answer "does this surface exist" is the check. Tracing whether each claim in a body still holds at HEAD is a different and much larger job, and it is not triage's: the delegate measures its own baseline when it picks the unit up, so a staleness sweep here is work thrown away for every issue that is not dispatched. On a measured board this doubled the token cost of triage, verifying 106 issues to dispatch 4. Confirm existence for the bucket; leave `ALREADY_SHIPPED` for cases the grep hands you for free; let the lane confirm the rest.

**Keep greps off generated files.** A single-line generated artifact (a bundled JSON, a lockfile, a compiled changelog) matched by a keyword returns the whole file as one line. One observed grep produced 1.1 MB of tool output that way. Exclude generated and vendored paths from any sweep, and pipe through `head -c` when the shape of a file is unknown.

- **"Missing" means absent from the filesystem.** A named product line with no application directory, a capability every epic assumes and no file implements. A 403 on a screen that exists, a hardcoded filter, an absent nav row for a route that is built — those are **defects**, however the title reads. Grep for the surface before calling it missing.
- **A `bug` label is a description of form, not a claim on a lane.** Likewise a `blocking` or `critical` label. If the adapter defines what qualifies as blocking, check the ticket against that list and record which item it satisfies; a unit that cannot name one is not blocking.
- **Note which tickets a previous automated run filed.** They dominate a board by recency, not importance. Mark them so the caller can place them; if the adapter says they go to the back, put them there. The test: would this ticket exist if the last run had not gone looking?

## Step 4: order the build queue

**Use the adapter's `priority_order`.** It is the house ordering and it wins outright.

Absent an adapter, order by delivery value, not by severity: surfaces that do not exist yet, then named contractual deliverables, then parity gaps against a reference implementation, then whole flows over fragments, then everything else. Defects that genuinely block one of those come with them.

**A severity sort is not a value sort.** Ranking by how alarming a ticket sounds reliably buries the work the project is paid for behind a queue of real-but-minor defects — in one run a named contract deliverable sat at position 29 of 39 behind eight consecutive bugs, every one of them genuine and two near-worthless.

**Honor `bug_budget` if the adapter sets one.** It caps the share of the queue that is bugs, chores, or test hygiene (`0.33` means at most one unit in three). It binds as a _running_ ratio, not on average over the whole queue: at every point in the order, the bugs so far may not exceed the budget's share of the units so far. Interleave to hold that from the first slot, rather than letting the opening fill with defects and averaging out later — "the blocking ones came first" does not repair it. Say in the digest which slots are the bug slots.

Round in the queue's favour on a short queue: with a budget of `0.33`, one bug in the first two units is within it, since demanding strictly fewer than one is a rule no opening wave could satisfy.

Ordering does not override the `HOLD` guardrail: production-sensitive work still routes to `HOLD` rather than jumping into an automated run.

## Step 5: cluster into disjoint groups

Group the `BUILD` queue into clusters that do not touch the same files, and give each a rough file footprint. The caller runs clusters in parallel and overlapping work serially, so the footprint is the whole basis of that decision. Be honest about reach: an optimistic footprint produces two agents editing the same file in two worktrees, and one of them loses.

Call out any single file that many queued units touch — a schema, a route table, a registry — so the caller never puts two of them in flight together. When overlap is not obvious from the issues, dispatch a scout rather than guessing.

## Ticket hygiene

Enforced by this skill, not left to the caller:

- **Never post a redundant comment.** Read the thread first. A comment is justified only when it adds new information.
- **When you need input, ask once.** One comment carrying your assessment, what prior art says (or that none exists), a concrete recommendation, and exactly what would unblock it. End with a line marking it automated, e.g. `posted automatically by task-triage; no further comments on this ticket until someone replies.`
- **Then stop** until someone responds. If a later pass finds the thread now answers the question, skip the comment and start the work.
- `FEEDBACK` and `HOLD` issues stay open with their one comment. Do not close them.
- File new issues for follow-ups you discover. Durable knowledge belongs on the ticket (an ordering constraint, a dead end already explored). Run bookkeeping does not — that is `task-tracking`'s job and it stays out of GitHub.

## Return: a digest, not a board

```
BUCKETS:
  #90  BUILD     bug        auth cookie dropped on subdomain
  #126 BUILD     feature    document preview pane
  #201 BUILD     missing    no application exists for the Spark product line
  #131 FEEDBACK  question   asked: which roles see drafts (recommended: admin only)
  #140 HOLD      migration  backfills org_id, needs approval
  #77  EPIC      tracking   covers #90, #126
  #188 BUILD     prevrun    filed by the last run; placed at the back

QUEUE (ordered): #201, #126, #90*, #155, #133*      (* = bug slot, 1 in 3)

CLUSTERS (disjoint, parallel-safe):
  A: #201        footprint: src/apps/spark/**, src/server/apps/spark/**
  B: #126        footprint: src/apps/preview/**, src/components/Pane.tsx
  C: #90, #155   footprint: src/auth/**, src/middleware/session.ts

CONTENDED: src/schema.ts touched by #201, #133, #147 — never two at once
ALREADY_SHIPPED: #118 (implemented in a1b2c3d, ticket still open)
COMMENTED: #131 (one comment posted)
NOTES: #126 blocked behind #90 by an ordering constraint recorded on the ticket

PREFILTERED: 22 bucketed from labels, not read (15 epic, 4 needs-input, 3 question)
REUSED: 84 unchanged since the last digest; 8 re-read
```

Return that and nothing else. No issue bodies, no thread summaries, no restated specs. If the caller needs detail, it can dispatch a scout at one ticket.

`PREFILTERED` and `REUSED` come straight off the `board-scan.sh` manifest. Carry them through: they are how the caller sees what triage skipped and why, and without them a cheap run and a broken one produce the same output.

Then run `board-scan.sh record` with the `BUCKETS` lines so the next run can reuse them.
