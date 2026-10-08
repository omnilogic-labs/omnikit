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
```

| Setting       | Meaning                                                                                        | Default                                     |
| ------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Base branch   | The branch each wave starts from and is fast-forwarded into.                                   | the branch checked out in the main checkout |
| Max lanes     | How many builders and verifiers run at once, counted together.                                 | 4                                           |
| Check command | The command that must pass on the integrated wave before the base branch moves.                | none; ask the owner at setup                |
| Push policy   | When to push the base branch: `never`, `after each wave`, or `after each milestone`.           | never                                       |
| Provision     | A shell command `wt create` runs inside each new worktree (install dependencies, copy `.env`). | none                                        |
| Teardown      | A shell command `wt remove` runs inside a worktree before removing it.                         | none                                        |
| Worktree root | Where worktrees go, relative to the main checkout or absolute.                                 | `../<repo>-worktrees`                       |
| Branch prefix | The prefix of each worktree's branch.                                                          | `wave/`                                     |

Notes:

- Provision output must be ignored by git (for example `node_modules/`), or the new worktree counts as dirty and
  `wt remove` refuses it.
- The coordinator reads max lanes, check command and push policy. `scripts/wt` reads the other five.
- If the check command is missing, the coordinator asks the owner once and records the answer in this file.
