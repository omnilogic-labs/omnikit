# Omnikit

Cross-platform agent skills by Omnilogic Labs, for Claude Code, Codex, and Antigravity (agy).

## Layout

- `plugins/omnilogic-labs/` is the one plugin: `skills/`, `agents/`, `bin/`, `evals/`
- `skills/` holds generated symlinks into the plugin for Codex and agy; never hand-edit
- `.claude-plugin/marketplace.json` is the marketplace manifest
- `install.sh` is the single install path; `scripts/skill-stats.sh` checks budgets

## Skills

- agent-browser: drive the agent-browser CLI
- artistic-vision: Gemini image generation and editing, Sharp processing
- coordinator: run multi-step work through planner, builder, and verifier agents
- onepassword: read secrets through the op CLI
- plain-writing: write prose a reader understands on the first pass
- primer: turn a product idea into a build brief and task files
- render: Render.com blueprints, SSH, and REST API

## Agents

- planner (opus), builder (sonnet; opus for complex work), verifier (sonnet)
- browser-buddy (haiku, medium effort): browser operator
- external-runner (haiku, low effort): starts one Codex or agy job via the external_worker tool

## Conventions

- Never use em dashes or en dashes.
- SKILL.md bodies at most 150 lines, descriptions at most 300 chars; enforced by `bun run budget` or `scripts/skill-stats.sh --strict`.
- Scripts use #!/bin/bash with set -e; status to stderr, output to stdout.
- Version bumps update both marketplace.json and plugin.json.
- Use `bun`, never npm or pnpm. After adding or renaming a skill, run `bash install.sh`.
- After changing skills, agents, or install.sh, run `bun run verify` (`bun run verify:ask` also asks each tool's model).
- Coordinate multi-step work with the coordinator skill; finished work lands on main with no leftover branches or worktrees.
