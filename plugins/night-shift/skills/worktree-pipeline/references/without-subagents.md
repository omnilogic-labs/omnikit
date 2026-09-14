# Running the pipeline without a subagent roster

Read this only when the harness has no agents to dispatch — Codex, Gemini, or any
runner without a subagent tool. With a roster available, the skill body applies as
written and this file does not.

This is a real fallback, not a stub. The procedure is the same; three things change.

- **Drop the concurrency cap to 1.** One context cannot supervise parallel lanes, and
  pretending otherwise produces half-finished worktrees.
- **Context fills much faster**, because the reading, the implementation, and the
  verification all land in one window. Provision, build, verify, integrate, and tear
  down one unit completely before starting the next, and keep per-unit notes to a few
  lines.
- **Run the stages as phases of your own work**, in the same order, with the same
  separations of concern. In particular, still write the acceptance criteria down
  before implementing, and still check them explicitly afterward against the running
  app. The value of the split survives without the agents; what is lost is the
  isolation, not the discipline.

Everything else holds: worktree per unit, disjoint work only, one integration at a
time, and the same contract values.

Say once that you are running this way, then stop mentioning it. The caller needs to
know the cap is 1; they do not need it restated at every unit.
