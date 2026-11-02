# Repo settings: `.agents/coordinator.md`

A repo can keep its coordinator settings in `.agents/coordinator.md`, at the root of the main checkout. Each setting
is one `key: value` line, optionally as a list item or with the key in bold. Keys are not case sensitive. Anything
else in the file (headings, notes) is ignored by `scripts/wt` but still read by the coordinator.

```markdown
# Coordinator settings

- Base branch: main
- Max lanes: 4
- Check command: `bun run check`
- Push policy: never; the owner pushes
- Provision: `bun install --frozen-lockfile`
- Teardown: `rm -rf node_modules`
- Worktree root: ../myrepo-worktrees
- Branch prefix: wave/
- Ledger: github
- Ledger repo: myorg/myrepo
- Project: myorg/3
- Plan dir: .agents/plans
```

| Setting       | Meaning                                                                                                         | Default                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Base branch   | The branch each wave starts from and is fast-forwarded into.                                                    | the branch checked out in the main checkout                              |
| Max lanes     | How many builders and verifiers run at once, counted together.                                                  | 4                                                                        |
| Check command | The command that must pass on the integrated wave before the base branch moves.                                 | none; ask the owner at setup                                             |
| Push policy   | When to push the base branch: `never`, `after each wave`, or `after each milestone`.                            | never                                                                    |
| Provision     | A shell command `wt create` runs inside each new worktree (install dependencies, copy `.env`).                  | none                                                                     |
| Teardown      | A shell command `wt remove` runs inside a worktree before removing it.                                          | none                                                                     |
| Worktree root | Where worktrees go, relative to the main checkout or absolute.                                                  | `../<repo>-worktrees`                                                    |
| Branch prefix | The prefix of each worktree's branch.                                                                           | `wave/`                                                                  |
| Ledger        | Where the ledger lives: `github` (issues) or `file` (`.agents/ledger.md`, not committed).                       | `github` when `gh` is signed in and the origin is on GitHub, else `file` |
| Ledger repo   | The `owner/repo` that holds the run and task issues: the repo whose code the run changes.                       | the origin's repo                                                        |
| Project       | An optional Projects v2 board, `owner/number`, that mirrors each task's state. Labels stay the source of truth. | none                                                                     |
| Plan dir      | Where planners write plans. Keep it out of git.                                                                 | `.agents/plans`                                                          |

Notes:

- Provision output must be ignored by git (for example `node_modules/`), or the new worktree counts as dirty and
  `wt remove` refuses it.
- The coordinator reads max lanes, check command and push policy. `scripts/wt` reads the worktree settings, and
  `scripts/ledger` reads the last four.
- Work that changes two repos is a run in the repo where most of it lands; a task for the other repo can be filed
  there by hand and added as a sub-issue (GitHub links sub-issues across repos of one owner).
- If the check command is missing, the coordinator asks the owner once and records the answer in this file.
