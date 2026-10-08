# Omnilogic Labs plugin

One plugin carrying every Omnilogic Labs skill and agent.

`skills/` and `agents/` here are generated from `src/` by `bun run build`. Do not edit them; edit `src/` and rebuild.

## Skills

- `agent-browser`: drive Vercel Labs' agent-browser CLI (snapshot-ref workflow, sessions, gotchas).
- `artistic-vision`: Gemini-powered image intelligence plus Sharp-powered local image processing.
- `coordinator`: run multi-step work through planner, builder, and verifier agents.
- `onepassword`: reliable secret retrieval from 1Password through the `op` CLI.
- `plain-writing`: how to write prose a reader understands on the first pass.
- `primer`: turn a vague product idea into a build brief, task files, and a build run.
- `render`: Render.com blueprints, SSH, hosting model, and REST API.

## Agents and binaries

- `agents/`: `planner`, `builder`, `verifier`, `external-runner`, and `browser-buddy`, a browser operator that returns a concise findings report.
- `bin/agent-browser`: bash shim that resolves the vendored `agent-browser` binary and guards one footgun (below). Claude Code puts `bin/` on `PATH` while the plugin is enabled.

## Dependencies

Run `bun install` at the repo root to install the workspace dependencies (`skills/artistic-vision` and `skills/agent-browser` are the two workspaces). For browser automation, `./setup-browser-buddy.sh` also downloads Chrome for Testing.

`skills/artistic-vision/bin/art` bootstraps itself. Claude Code copies an installed plugin into its cache, where no `node_modules` exists above the scripts. On first run `art` checks that `sharp`, `commander`, and `@google/genai` resolve; if not, it runs `bun install` in the nearest directory holding a `package.json` (the skill directory) and reports that on stderr. Inside a clone, the workspace install satisfies the check and nothing extra is installed. Gemini subcommands need `GEMINI_API_KEY` (`GOOGLE_API_KEY` is a legacy fallback); the Sharp subcommands are local.

## The flag guard

`bin/agent-browser` refuses flag-shaped arguments that the CLI's own `--help` does not document. Several subcommands take bare positionals, so `agent-browser screenshot h1 --full-page` would save a file literally named `--full-page` and report success. The guard learns the valid set from `--help` at runtime and fails open when it cannot determine the answer. Bypass with `AGENT_BROWSER_SKIP_FLAG_CHECK=1`.

The skill keeps its own prose instead of shipping upstream's discovery stub, because it adds the delegation decision, the setup script, the flag guard, and measured gotchas. Version-specific detail defers to `agent-browser skills get core --full`. If you also install upstream's own Claude Code plugin, the skill name `agent-browser` collides; keep one.

## Evals

The browser-buddy evaluation harness lives outside the plugin, in `bench/browser-buddy/`. See its README.

The `primer` skill is prompt-only and vendors one runner under its own directory.

The `agent-browser` CLI is built and maintained by Vercel Labs.
