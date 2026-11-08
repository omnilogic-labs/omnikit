# Workers on one shared machine

Read this when builders and verifiers run on the same machine as you and each other. The role prompts carry the
worker side (long commands in the background, own log names, own processes only, no long waits). This is your side.

- **Hold long waits on the outside world yourself.** A worker blocked in a long sleep cannot be steered. Split a
  task that waits on the outside world (a deploy settling, an instance sleeping, anything over about 15 minutes):
  a short worker starts it and records the time, you wait with a background timer, and a fresh short worker
  measures the result. A test or check run is not such a wait: the worker runs it in the background and waits.
- **Watch for stalls.** A worker saying it is "waiting for the check" is a claim. If its log has not changed in
  about 20 minutes, ask it what the log shows, or stop it and redispatch. Stop finished workers that still hold
  background work.
- **Check the disk at each wave** (`df -h`). Worktrees, per-lane databases and test containers fill it, and a full
  disk fails every check for reasons unrelated to the code. Clean up only what the run created; the repo's
  AGENTS.md names anything that must never be pruned.
- **Before an owner-facing ask about an outside service**, read the evidence behind the worker's diagnosis and
  check it can tell the claimed cause apart from others. Say "cause unknown" when it is, and ask for the
  observation that would settle it, not for a fix.
- **Keep the owner's view small.** Relay two lines, not the report. Do not stream monitor events into your own
  context; a status-line tool or one check per wave is enough.
