# Omnikit

Cross-platform agent skills by Omnilogic Labs, for Claude Code, Codex, and Antigravity (agy).

## Layout

- `src/skills/` and `src/agents/` are the source. Edit there, never the generated output: `plugins/omnilogic-labs/{skills,agents}`, root `skills/`, and `dist/`
- `scripts/build/` is the compiler; `hosts.ts` is the one table of per-host models and tools, `os.ts` the OS table
- `bun run build` regenerates every tree; run it after any `src/` or `scripts/build/` change. Committed trees are always any-OS; `dist/` follows `OMNIKIT_OS`, else the OS in `dist/*/.os`, else the detected OS, and `--os` overrides. `bun run build:check` and `bun run verify` fail on stale output
- `plugins/omnilogic-labs/` is the one plugin: generated `skills/` and `agents/`, plus `bin/`, `evals/`
- `skills/` is the committed portable copy for `npx skills` (a dispatcher plus `platforms/<host>.md`); `dist/` is gitignored, built per machine
- `.claude-plugin/marketplace.json` is the marketplace manifest
- `install.sh` is the single install path; `scripts/skill-stats.sh` checks budgets

## Skills

- agent-browser: drive the agent-browser CLI
- artistic-vision: Gemini image generation and editing, Sharp processing
- coordinator: run multi-step work through planner, builder, and verifier agents
- onepassword: read secrets through the op CLI
- plain-writing: write prose a reader understands on the first pass
- primer: turn a product idea into a build brief and task files
- questionnaire: turn a JSON list of decisions into an artifact page the owner answers and pastes back
- render: Render.com blueprints, SSH, and REST API

## Agents

- planner (opus), builder (sonnet; opus for complex work), verifier (sonnet)
- browser-buddy (haiku, medium effort): browser operator
- external-runner (haiku, low effort): runs one Codex or agy job via the external_worker tool, relays its progress, and returns the final message; the main thread may not call the tool itself

## Conventions

- Never use em dashes or en dashes.
- SKILL.md bodies at most 150 lines, descriptions at most 300 chars; enforced by `bun run budget` or `scripts/skill-stats.sh --strict`.
- Scripts use #!/bin/bash with set -e; status to stderr, output to stdout.
- Windows: where a SKILL.md tells the agent to run a bash helper, say to run it from Git Bash, or from PowerShell via `& "$env:ProgramFiles\Git\bin\bash.exe"`, never bare (an extensionless file opens an "Open with" dialog and hangs the agent). See README, Windows.
- A script that finds files relative to itself resolves its path with `realpath "$0"` first: Codex and agy reach it through a symlink, and Git Bash's `cd -P` resolves only the last component.
- Paths handed to `$.fs` in hooks are resolved by the engine, so `/tmp/x` is `<current drive>:\tmp\x` on Windows while bash sees `%TEMP%\x`. Share one path between them by having bash print it (`pwd -W` in Git Bash).
- Version bumps update both marketplace.json and plugin.json.
- Use `bun`, never npm or pnpm. After adding or renaming a skill, run `bun run build` and `bash install.sh`.
- Name no model outside `hosts.ts`; templates use `{{tier.deep}}` and similar.
- After changing skills, agents, or install.sh, run `bun run verify` (`bun run verify:ask` also asks each tool's model).
- Coordinate multi-step work with the coordinator skill; finished work lands on main with no leftover branches or worktrees.
