# Tracking a run without the task tools

Read this only when the built-in task tools are genuinely unavailable. In a foreground
Claude Code session they are available, and this file does not apply.

## When it applies

- **Background subagents** keep a reduced built-in tool set, and the task tools are not
  in it. A `TaskCreate` or `TaskList` call there errors with "not enabled in this
  context".
- **Codex and Gemini** have no task list at all.

## What to do instead

- Keep the same list in a single compact block you rewrite each turn, in the transcript
  or in a scratch file. Same fields, same states, same transitions as the skill body.
- Rewrite it in full on each update rather than appending deltas, so the current state
  is always readable in one place.
- Say once, at the start, that you are tracking this way — then carry on without
  repeating it. A caller who thinks entries are being filed and finds nothing afterward
  has lost the run's history; a caller told five times has lost their patience.
