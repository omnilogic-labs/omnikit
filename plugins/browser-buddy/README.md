# browser-buddy

Browser automation plugin built on Vercel Labs' [agent-browser](https://github.com/vercel-labs/agent-browser) CLI. It ships two pieces:

- **`agent-browser` skill**: teaches an agent how to drive the CLI directly (snapshot-ref workflow, sessions, gotchas). The CLI's own `agent-browser skills get core --full` is the canonical, version-matched command reference; the skill stays thin on purpose.
- **`browser-buddy` agent**: a sonnet-powered operator subagent. Give it a high-level task ("browse the whole site, use all the forms, report anything broken") and it does the multi-step browsing, screenshot reading, and console-log diagnosis internally, returning a concise findings report. All the opinionated workflow (JPEG screenshots, session hygiene, evidence-based reporting) lives here.

## Setup

Bun is the only external system dependency. The `agent-browser` binary is vendored through Bun workspaces.

```bash
# Once, from the omnikit repo root:
./setup-browser-buddy.sh
```

That runs `bun install`, downloads Chrome for Testing (skipped if a compatible Chrome, Brave, Playwright, or Puppeteer install exists), and symlinks `agent-browser` into `~/.local/bin`. In Claude Code the plugin's `bin/` directory is on `PATH` automatically while the plugin is enabled.

## What's in this plugin

- `skills/agent-browser/SKILL.md`: entry point for agents; the core loop, sessions, a command map, and hard-won gotchas, deferring to `agent-browser skills get core --full` for the full reference.
- `agents/browser-buddy.md`: the Claude operator agent definition (`model: sonnet`, `effort: medium`). Codex resolves the same role at capability tier 3, currently Terra at medium, through Night Shift's `roles.yaml`.
- `bin/agent-browser`: bash shim that resolves the vendored binary and guards one silent footgun (see below).
- `eval/`: evaluation harness that scores the agent against a local site with planted defects and a known answer key, across model and effort configurations. Measures defect recall, fabrication rate, session hygiene, and cost per trial. See `eval/README.md`.

## How this relates to upstream's own skill

Upstream packages its skill as a **thin discovery stub** (`skills/agent-browser/SKILL.md`, ~3KB, `hidden: true`) whose only real job is to tell the agent to run `agent-browser skills get core`. The substance lives in `skill-data/{core,dogfood,electron,slack,derive-client,vercel-sandbox,agentcore}/` inside the npm package and is served by the binary, so the instructions always match the installed version.

We keep our own prose rather than shipping their stub because the plugin adds things the stub cannot know about: the delegation-to-browser-buddy decision, our setup script, the flag guard, and gotchas we hit and measured ourselves. Everything version-specific is deferred to `skills get`, so our file does not go stale as the CLI moves.

Because the vendored npm package already contains upstream's skill content on disk (`agent-browser skills path core`), there is no reason to add the upstream repo as a git submodule: it would duplicate content we already have and could drift from the installed binary, which is the exact failure mode the runtime `skills get` design avoids.

Note: upstream also publishes its stub as a Claude Code plugin via its own `.claude-plugin/marketplace.json`. If you install both that and this plugin, the skill name `agent-browser` collides; keep one.

## The flag guard

`bin/agent-browser` refuses flag-shaped arguments that the CLI's own `--help` does not document, because several subcommands take bare positionals and the CLI accepts an unknown flag as one. `agent-browser screenshot h1 --full-page` reports `✓ Screenshot saved to --full-page` and leaves a file by that name in the working directory (still true on 0.33.1). Agents then repeat the guess forever, since nothing tells them it was wrong.

The guard learns the valid set from `--help` at runtime, so it needs no maintenance as the CLI changes, and it fails open when it cannot determine the answer. Bypass with `AGENT_BROWSER_SKIP_FLAG_CHECK=1`.

## Credit

The `agent-browser` CLI is built and maintained by Vercel Labs. This plugin wraps it with our own prose, workflow opinions, and the browser-buddy operator agent.
