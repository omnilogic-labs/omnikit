# The step-file template

This is the compatibility contract between a forged plan and the machinery that runs it.
`plan-queue` derives its queue from the header lines; `night-shift-planned-delegate` takes
Verify as its acceptance criteria, Don't as graded scope fences, and Commit as the message.
A solo consuming agent reads the same sections in the same order. Every step file follows it
exactly — same headers, same order, nothing renamed.

```markdown
# NN — <Title>

**Goal:** <one sentence>
**Why:** <2–5 sentences: what is wrong or wanted, the evidence, what breaks or stays broken
if skipped. Cite `file:line` as of the authoring date and say that lines drift — the
executor anchors by searching for the quoted code, never by line number.>
**Depends on:** <step numbers, or "nothing">  **Parallel-safe with:** <step numbers, or
"run solo"; name the exact file conflict behind every NOT — "NOT 10 (both edit
the cart service entry point)">
**Size:** S | M | L

## Steps

<Numbered, concrete instructions. Full paths from the target repo root. One instruction per
item. Quote the current code being changed so the executor can locate it by content. Code
sketches for settled designs, marked as the intended shape to adapt, not paste verbatim.>

## Don't

<Scope fences: what is out of bounds for this step, which tempting improvements are another
step's job (name the step), and the traps a capable executor would otherwise walk into.>

## Verify

<Exact commands with expected outcomes. Always the target repo's own toolchain gates
(typecheck, build, full test suite — never path-scoped where the repo forbids it), then
step-specific proof: grep counts, a named guard suite, a browser walk with what to look at.>

## Commit

`<suggested conventional commit subject>` <plus "Closes #NNN" / "(#NNN)" where a tracker
issue applies>
```

Size means executor sessions: S under an hour, M one to three hours, L a half-day. Bigger
than L is two steps.

## Rules the template implies

- **Depends on / Parallel-safe with are authoritative.** The index's table is a map; these
  lines are the territory. A runner pairs worktrees from them, so an optimistic
  "parallel-safe" here costs someone a ruined branch.
- **A step that moves, renames, or splits files says "run solo"** — it conflicts with
  everything touching those files, including steps that only read them today.
- **A checkpoint step says so in its title and its first instruction** ("STOP — confirm with
  the owner"), states what to present and what the open choices are, and says what an
  unattended run does (skip, leave open, report) rather than leaving it to improvise.
- **Verify includes the fences.** If Don't says move-only, Verify shows how that is checked
  (a diff-stat bound, an unchanged test count, a registry-identity guard). A fence no one
  can grade is a suggestion.
- **The Why is for adaptation, not motivation.** When the repo has drifted from the plan,
  the executor re-derives intent from Why and adapts mechanically; a step whose Why is
  boilerplate strands them.
- **`> Note:` at the top of a file** records where the authoring pass found its source
  material wrong or drifted: what was claimed, what is actually there. It is the plan
  correcting itself in daylight.

## The index (`00-README.md`) carries

1. What the plan is and why it exists — a paragraph an executor actually needs, not a
   pasted report.
2. **The protocol**: work order; which step gates the rest and must land first; the
   per-step loop (implement → run the gates → commit → push, as the plan wants it); push
   cadence and what a push means in this repo (a deploy?); tolerated breakage between
   steps; drift handling ("search for the quoted code; if a step is already done, note it
   and move on"); the toolchain facts (package manager, the commands, what never to
   path-scope).
3. **The step table** per phase — number, linked file, size — with the wave/parallelism map
   and the known unsafe pairings, plus the line that the step files' own header lines win
   over this table.
4. **Checkpoints**, named loudly.
5. **The "deliberately NOT doing" list**, with reasons — the design's rejected options,
   written down so no executor helpfully re-attempts them.
