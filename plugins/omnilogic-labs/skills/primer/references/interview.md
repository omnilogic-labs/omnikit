# Interview playbook

The opening idea is vague on purpose ("a sales app that helps you rehearse
interactions with people"). Your job in Phase 1 is to resolve the few decisions
that change the shape of the build, then let everything else be discovered during
research and decomposition. Do not try to specify the whole product up front.

## Principles

- **Ask in batches, not one at a time.** Use `AskUserQuestion` with up to four
  questions per call. One or two batches is usually enough.
- **Every question carries a proposed answer.** Phrase options as concrete
  choices with a recommendation, not "what do you want?". This mirrors the
  "Judgment Calls" framing in the primers: a specific question with a proposed
  answer is respectful of the user's time and easy to approve or correct.
- **Stop asking once you can write the primer.** Anything still open after the
  interview becomes a Judgment Call recorded in the primer, not a blocker.

## What you must pin down

These five shape the build. You cannot write a good primer without them.

1. **Audience and core loop.** Who uses this, and what is the single repeated
   action at its heart? For the sales-rehearsal example: is the core loop "user
   picks a scenario, role-plays a conversation with an AI counterpart, gets
   feedback"? Nail the loop; everything else hangs off it.
2. **Platform.** Web app, mobile, desktop, CLI, browser extension, or a service
   with no UI. This decides the entire stack.
3. **Hard constraints the user already holds.** Existing stack they must match,
   a deploy target, a database they already run, an auth provider, a budget or
   timeline. Surface these so they become Hard Constraints, not surprises.
4. **Scope boundary for the first build.** What is explicitly NOT in the first
   version. Vague ideas expand without this. Name the cuts.
5. **Definition of good-enough.** What the first build must demonstrate to be
   worth iterating on. This becomes the "What the MVP should do" section and the
   acceptance bar for the task breakdown.

## What NOT to ask

- Do not ask for decisions you can make better after research (exact library
  versions, specific component libraries) unless the user has a standing
  preference. Pin those in Phase 2.
- Do not ask about details that do not change the build shape (color choices,
  copy, naming) at interview time. Those are refinement, not structure.
- Do not ask the user to design the schema. You propose it in Phase 2; they
  react.

## Example batch (sales-rehearsal app)

A good first batch for the example prompt:

- **Core loop**: "Is the loop: pick a scenario, role-play with an AI
  counterpart, get scored feedback?" Options: that loop / a freeform practice
  chat with feedback after / a guided drill with set prompts. Recommend the
  scenario-based loop.
- **Platform**: web / mobile / desktop. Recommend web for the first build.
- **Counterpart realism**: text chat / text plus voice / voice-first. Recommend
  text first, voice as a deferred Judgment Call.
- **Scope cut**: single-player practice only for v1, or multi-user / team
  features in v1? Recommend single-player first.

After this batch you typically know enough to research the stack and draft the
primer. Record voice, teams, and anything else deferred as Judgment Calls.
