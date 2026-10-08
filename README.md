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

## Install

Clone, preview, then install. The installer is safe to re-run.

```bash
git clone https://github.com/omnilogic-labs/omnikit.git
cd omnikit
bash install.sh --dry-run   # print what would change, change nothing
bash install.sh
```

| Tool            | How it installs                                                         |
| --------------- | ----------------------------------------------------------------------- |
| Claude Code     | `omnilogic-labs@omnikit` plugin from this clone's `omnikit` marketplace |
| Codex CLI       | one symlink per skill in `~/.agents/skills`, live on edit               |
| Antigravity CLI | one symlink per skill in `~/.gemini/config/skills`, live on edit        |
| Gemini CLI      | this clone linked as an extension (`gemini-extension.json`)             |

The installer picks every tool it finds on PATH and says which ones it skipped. Other flags: `--claude`, `--codex`, `--agy`, `--gemini` (one tool only), `--browser` (also set up agent-browser and Chrome), `--force`, `--check`, `--help`. Re-run after a `git pull` that adds or renames a skill, and restart open Claude Code, Codex, and agy sessions so they rescan.

Run the installer from the main checkout, not a worktree: Claude Code's marketplace points at whichever clone ran it.

## Verify

```bash
bun run verify       # install.sh --check, Claude Code plugin state and init event, skill links
bun run verify:ask   # the same, plus one model query each to claude, codex, and agy
```

Success is exit 0 and a last stdout line like `summary pass=19 fail=0 skip=0`. Each check prints one `pass`, `fail`, or `skip` line. What each tool should see:

- Claude Code: 7 skills and 5 agents, all named `omnilogic-labs:<name>`, no unprefixed copies, and the `mcp__omnilogic-labs__external_worker` tool. The script reads the `system/init` event of `claude -p --output-format stream-json --verbose`, which lists `skills`, `agents`, `plugins`, and `tools`.
- Codex: the 7 skills, shown as `omnilogic-labs:<name>` because the links resolve into the plugin. Ask with `codex exec -s read-only "list your skills" </dev/null`.
- Antigravity: the 7 skills, unprefixed. Ask with `agy -p "list your skills" --mode plan --sandbox </dev/null`.

Troubleshooting:

- agy lists no omnikit skills: it reads `~/.gemini/config/skills`, not `~/.agents/skills`. Run `bash install.sh --agy`.
- agy drops one skill silently: its YAML parser is strict, so a `description:` with an unquoted `: ` fails. Use a `>-` block. The error is in `~/.gemini/antigravity-cli/cli.log`.
- Codex lists extra skills such as `core`, `dogfood`, or a bare `agent-browser`: Codex walks skill folders several levels deep and finds the SKILL.md files inside a skill's `node_modules`. `bunfig.toml` hoists dependencies to the root, and `bash install.sh` removes any per-skill `node_modules` left from before.
- Claude Code shows a skill twice, once without the prefix: a legacy link in `~/.claude/skills` or `~/.claude/agents`. `bash install.sh` removes links into this repo and leaves everything else alone.
- `claude-marketplace` fails: the marketplace points at another clone or a worktree. Run `bash install.sh --claude` from the main checkout.

## Development

This repo is a [Bun](https://bun.com) workspace. To get started:

```bash
bun install
```

Each plugin under `plugins/*` is a workspace member. The root package is private and not published to npm; distribution happens via the Git repo itself (see Install above).

## Repository Structure

```
omnikit/
  AGENTS.md                         # Layout, skills, conventions (CLAUDE.md imports it)
  .claude-plugin/marketplace.json   # Claude Code marketplace manifest
  gemini-extension.json             # Gemini CLI extension manifest
  plugins/omnilogic-labs/           # The plugin: skills/, agents/, bin/, evals/
  skills/                           # Generated symlinks for Codex and Gemini
  install.sh                        # Installs into Claude Code, Codex, agy, and Gemini
  scripts/verify-install.sh         # Checks what each tool registered
  scripts/skill-stats.sh            # Token and size budget check
```

## Contributing

Follow the conventions in AGENTS.md, run `bun run check` and `bun run budget`, and open a PR.

To add a skill, create `plugins/omnilogic-labs/skills/<name>/SKILL.md` with YAML frontmatter, then run `bash install.sh`.

## License

[MIT](LICENSE) - Omnilogic Labs
