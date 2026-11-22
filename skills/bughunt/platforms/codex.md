# Bughunt

You send out bughunters and collect their reports. A hunter is a fast-tier agent that drives the browser until it
finds a bug, asks a deep-tier agent how to fix it, fixes it in its own worktree, retests, commits on its own
branch, and reports. You do not hunt or fix yourself. What happens to the branches afterwards is up to you and the
repo's own workflow; this skill says nothing about it.

## Before you start

1. Read the project file, `.agents/bughunt.md` in the target repo's main checkout. It holds the target URL, how to
   pass a sign-in or gate, where secrets live, how to make a worktree, how to start a local build on a free port,
   the quick check, and the project's rules. `references/project-file.md` documents each field and
   has a template; `references/example-project.md` is a filled-in example. With no project file, write one from
   the template with the owner's answers first; never guess a secret's location or a production rule.
2. Decide how many hunters (default 3) and whether each gets a goal or area ("the share dialog", "boards on a
   phone"). Hunters with no goal roam; give roaming hunters different starting pages so they do not all find the
   same bug.
3. Check the disk (`df -h`) and what is already running. Never give one area two hunters.

## Dispatch

For each hunter:

1. Create its worktree with the project file's command (for example the coordinator skill's `scripts/wt create
hunt-<n>`), which prints the path. Run the project's provision step there if it has one.
2. Pick a browser session name, `hunt-<n>`, unique to that hunter.
3. Dispatch one `bughunter` agent in the background, all hunters in one message so they run in parallel.

On Codex: `spawn_agent` with `agent_type: "bughunter"` on `gpt-6-luna` at effort `medium`, then
`wait_agent`. If it is not installed, pass the body of the installed `bughunter` agent file as the prompt's start.

Each prompt names only these:

```
Project file: <absolute path to the main checkout's .agents/bughunt.md>
Worktree: <absolute worktree path> (branch <branch>)
Browser session: hunt-<n>
Target: <live URL or "local build">
Goal: <area or flow to hunt in, or "none: roam">
Bugs: 1
Reply file: <absolute path>
```

Give the project file by its main-checkout path: it is often untracked or gitignored, so a fresh worktree lacks it. Ask for more
than one bug only when the owner asks; each bug is its own commit. Default reply file:
`$(git -C <worktree> rev-parse --git-path bughunt-reply.md)`.

## Reading reports

A hunter replies in a few lines per bug: the bug, the repro, the fix (files, branch, commit), the retest result, and
anything unverified. Its "fixed" is a claim backed by its own retest, not an independent check. It may also report
a bug unfixed after two rounds, or one that does not reproduce on a local build; those come back with their repro
and no commit.

Ask a hunter a follow-up instead of reading its diff yourself.
A hunter never pushes, merges or removes its worktree; each worktree stays with its branch for you.

## Report

Five lines or fewer: how many hunters ran, and per bug the hunter, the one-line bug, fixed or not, and the branch
and commit; then anything that needs the owner (a credential, a rule, a check only possible after a deploy).

## References

- `references/project-file.md`: the `.agents/bughunt.md` fields, the safety rules every hunter keeps, and a
  template.
- `references/example-project.md`: a filled-in project file for a Next.js app behind a password gate.
