# Omnikit

Cross-platform agent skills for [Claude Code](https://claude.com/claude-code), [Codex CLI](https://github.com/openai/codex), and [Gemini CLI](https://github.com/google-gemini/gemini-cli). By [Omnilogic Labs](https://github.com/omnilogic-labs).

## Skills

One plugin, `omnilogic-labs`, carries every skill and agent. In Claude Code they are namespaced `omnilogic-labs:<name>`.

- `agent-browser`: drive Vercel's [agent-browser](https://github.com/vercel-labs/agent-browser) CLI
- `artistic-vision`: Gemini image generation and editing, Sharp local processing
- `coordinator`: run multi-step work through planner, builder, and verifier agents
- `onepassword`: read secrets through the `op` CLI
- `plain-writing`: write prose a reader understands on the first pass
- `primer`: turn a product idea into a build brief and task files
- `render`: Render.com blueprints, SSH, and REST API

Agents: `planner`, `builder`, `verifier`, and `browser-buddy` (Claude Code only).

## Installation

Clone, preview, then install. The installer is safe to re-run.

```bash
git clone https://github.com/omnilogic-labs/omnikit.git
cd omnikit
bash install.sh --dry-run   # report what would change, change nothing
bash install.sh
```

| Tool        | How it installs                                               |
| ----------- | ------------------------------------------------------------- |
| Claude Code | `omnilogic-labs@omnikit` plugin from this clone's marketplace |
| Codex CLI   | one symlink per skill in `~/.agents/skills`, live on edit     |
| Gemini CLI  | this clone linked as an extension (`gemini-extension.json`)   |

Other flags: `--claude`, `--codex`, `--gemini` (one tool only), `--browser` (also set up agent-browser and Chrome), `--force`, `--check`, `--help`. Re-run after a `git pull` that adds or renames a skill.

## Development

This repo is a [Bun](https://bun.com) workspace. To get started:

```bash
bun install
```

Each plugin under `plugins/*` is a workspace member. The root package is private and not published to npm; distribution happens via the Git repo itself (see Installation above).

## Repository Structure

```
omnikit/
  AGENTS.md                         # Layout, skills, conventions (CLAUDE.md imports it)
  .claude-plugin/marketplace.json   # Claude Code marketplace manifest
  gemini-extension.json             # Gemini CLI extension manifest
  plugins/omnilogic-labs/           # The plugin: skills/, agents/, bin/, evals/
  skills/                           # Generated symlinks for Codex and Gemini
  install.sh                        # Installs into Claude Code, Codex, and Gemini
  scripts/skill-stats.sh            # Token and size budget check
```

## Contributing

Follow the conventions in AGENTS.md, run `bun run check` and `bun run budget`, and open a PR.

To add a skill, create `plugins/omnilogic-labs/skills/<name>/SKILL.md` with YAML frontmatter, then run `bash install.sh`.

## License

[MIT](LICENSE) - Omnilogic Labs
