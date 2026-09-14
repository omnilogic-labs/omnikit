---
name: task-tracking
description: >-
  Maintain a run's list of work in the built-in task list: one entry per unit,
  with state, lane, and the model and reasoning level used for each dispatch.
  Use during a multi-unit run so a returned result costs one write instead of a
  paragraph of context, and so "what is running right now" can be answered
  without re-deriving it. Files nothing to the issue tracker.
---

# task-tracking

The run's working memory. One entry per unit of work, updated on every transition, and answerable cheaply when someone asks what is happening.

This skill tracks a run. It does not write to GitHub. That boundary is the point: durable knowledge belongs on the ticket and gets there through `task-triage`'s hygiene rules, while run bookkeeping stays here and dies with the run.

## Where the list comes from

Either of two ways:

1. **The goals you were given**, as the run command received them: `any open bugs on github`, or `#90 then #126`, or a focus area. Take them as stated, including any ordering the user implied.
2. **Your own reading of task state**, when no goals were named. Work out what should be worked on from the `task-triage` digest, what is already in flight (worktrees, branches, unpushed commits), and what is blocked. Prefer finishing in-flight work over starting new work.

Either way the list is derived at the start of the run and does not carry over to the next one. Neither the run nor the list is durable, and neither needs to be: git, the tracker, and the worktree list are what survive.

## The entry

One per unit of work, carrying:

- **id**: the issue number or unit identifier
- **state**: `queued`, `dispatched`, `returned-green`, `parked`, `integrated`, `pushed`, `reconciled`
- **lane**: which lane it occupies, or none
- **dispatches**: one line each, with the model and the reasoning level actually used
- **footprint**: the files it claims, so disjointness can be checked without re-deriving it
- **note**: one line, the current reason or the last outcome

Use `TaskCreate` to open entries and `TaskUpdate` on every transition. A returned result is one write, not a paragraph in the caller's context.

## Transitions

```
queued -> dispatched         (lane assigned, worktree and port recorded)
dispatched -> returned-green (delegate returned GREEN with a SHA)
dispatched -> parked         (BLOCKED, environment failure, or needs a decision)
returned-green -> integrated (integrator landed a squash commit)
integrated -> pushed         (push policy allowed it)
pushed -> reconciled         (ticket closed or noted, worktree torn down)
parked -> queued             (only when its inputs changed; never a blind retry)
```

Record the transition, not the story. "returned-green, a1b2c3d" is the entry; the reasoning behind it lived in the delegate's context and can stay there.

## Dispatch records carry model and reasoning together

Every dispatch line records both, because a bad result usually traces to a downgrade:

```
#126 planner    model=fable  effort=high
#126 delegate   model=opus   effort=high
#126 scout      model=sonnet effort=medium
#126 integrator model=opus   effort=high   (model override applied)
```

Record what actually ran, never what was asked for.

These are log lines, not talking points. Effort is worth a sentence to the user in exactly one case: they asked for a level that could not be applied, in which case say so once and move on. Otherwise write the level down and say nothing about it — an unprompted note explaining that reasoning cannot be set at dispatch is a non-event reported as a defect. The resolution rules are in the worktree-pipeline skill's `references/models-and-effort.md`.

## Answering the status question

Keep the list good enough that "what is running?" is a read, not a re-derivation. A status answer is one screen:

- lanes in use, and the unit in each
- state per unit, one line
- what is queued next
- what is parked, and why

If answering that requires re-reading git or the tracker, the list was not maintained. Fix the list.

## Not this skill's job

- **Writing to GitHub.** Not a comment, not a label, not a close. That is `task-triage`.
- **Deciding what to work on.** That is triage plus the caller.
- **Holding detail.** If an entry needs a paragraph, the paragraph belongs in the agent's return or on the ticket, and the entry gets the one-line version.

Worth writing to a ticket instead of here: an ordering constraint ("do not land #126 before #90"), or a dead end already explored ("tried this with webcontainers, did not work"). A future run cannot derive those from code or issue state. It can derive everything in this list.

## Without the task tools

If a `TaskCreate` call errors with "not enabled in this context" — background subagents, Codex, Gemini — read `references/without-task-tools.md` and track the same list by hand. Do not read it otherwise: in a foreground session the tools are there and the fallback does not apply.
