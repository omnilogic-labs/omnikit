# Omnikit

Cross-platform agent skills for [Claude Code](https://claude.com/claude-code), [Codex CLI](https://github.com/openai/codex), and [Gemini CLI](https://github.com/google-gemini/gemini-cli). By [Omnilogic Labs](https://github.com/omnilogic-labs).

## Skills

### Browser Buddy

Browser automation built on Vercel's [agent-browser](https://github.com/vercel-labs/agent-browser) CLI. Ships an `agent-browser` skill (how to drive the CLI: snapshot refs, sessions, gotchas) and a `browser-buddy` agent, a sonnet-powered operator that takes a high-level task like "browse the whole site, use all the forms, report anything broken" and returns a concise findings report.

### Artistic Vision

Image generation via [Nano Banana](https://github.com/kingbootoshi/nano-banana-2-skill) (Google Gemini image models) and local image processing via Sharp, ImageMagick, and FFmpeg. Generate from prompts, edit existing images, create transparent assets, resize, convert, and batch process.

### Plain Writing

How to write prose a reader understands on the first pass: documentation,
findings, status updates, summaries, commit messages, and pull request
descriptions. Targets the habits that make otherwise competent technical writing
hard to use, including delaying the point for effect, inventing vocabulary the
reader has to memorise, giving judgements where a measurement would do, and
compressing an idea until only the author can unpack it. Ships the rules, a
ten-step revision pass to run against any draft, twelve before and after
rewrites, and skeletons for the common document types.

### Night Shift

Runs a board of work unattended. Ships a roster of small composable agents (orchestrator, delegate, planner, researcher, scout, verifier, fixer, integrator), three skills (`task-triage`, `worktree-pipeline`, `task-tracking`), and the `/orchestrate`, `/drain`, and `/abort` commands. `/orchestrate any open bugs on github` triages the board, builds each unit in its own worktree, grades it against criteria it did not write for itself, and lands it, while you steer from the foreground. Every agent is usable on its own. Nothing in the package names a project: all specifics live in a `.claude/night-shift.md` adapter in the consuming repo.

## Installation

### Clone and link (recommended)

Clone the repo and run the installer. It links every skill, agent, and command
into the tools it finds on your PATH, as symlinks back into your clone, so you
can edit any skill in place and the change is live on the next session. Nothing
is copied, so nothing drifts.

```bash
git clone https://github.com/omnilogic-labs/omnikit.git
cd omnikit && bash install.sh
```

It is safe to re-run, and you should re-run it after every `git pull` that adds
or renames a skill. It installs:

| Tool        | What it links                     | Where                                |
| ----------- | --------------------------------- | ------------------------------------ |
| Claude Code | 11 skills, 11 agents, 3 commands  | `~/.claude/{skills,agents,commands}` |
| Codex CLI   | 11 skills                         | `~/.codex/skills`                    |
| Gemini CLI  | this clone, as a linked extension | `gemini extensions link .`           |

Useful flags:

```bash
bash install.sh --dry-run     # report what would change, change nothing
bash install.sh --claude      # one tool only (also --codex, --gemini)
bash install.sh --browser     # also set up agent-browser and Chrome
bash install.sh --force       # move aside a real file blocking a link
bash install.sh --help
```

The installer never clobbers a file it did not create. If a skill, agent, or
command name collides with one you already have, it reports the conflict and
leaves your file alone until you pass `--force`, which moves yours aside with a
timestamp.

Agents are linked under the name in their frontmatter, not their filename, so
`agents/planner.md` installs as `night-shift-planner.md` and will not collide
with a `planner.md` of your own.

`CLAUDE_CONFIG_DIR` and `CODEX_HOME` are respected if you have moved either
config directory.

### Claude Code, as a marketplace

For a read-only install that updates on `/plugin update` rather than on save:

```
/plugin marketplace add omnilogic-labs/omnikit
```

Then install individual plugins:

```
/plugin install browser-buddy@omnikit
/plugin install artistic-vision@omnikit
/plugin install onepassword@omnikit
/plugin install render@omnikit
/plugin install night-shift@omnikit
/plugin install primer@omnikit
/plugin install plain-writing@omnikit
```

### Codex CLI, via the built-in installer

```
$skill-installer install browser-buddy from omnilogic-labs/omnikit
```

This copies the skill into `~/.codex/skills`, so edits to the copy do not reach
the repo. Use the clone and link path above if you plan to edit skills.

### Universal (npx)

Works with Claude Code, Codex, Gemini CLI, Cursor, and 40+ other agents:

```
npx skills add omnilogic-labs/omnikit
```

## Development

This repo is a [Bun](https://bun.com) workspace. To get started:

```bash
bun install
```

Each plugin under `plugins/*` is a workspace member. The root package is private and not published to npm; distribution happens via the Git repo itself (see Installation above).

## Repository Structure

```
omnikit/
  package.json                      # Bun workspace root (private)
  .claude-plugin/marketplace.json   # Claude Code marketplace manifest
  gemini-extension.json             # Gemini CLI extension manifest
  plugins/                          # Canonical skill sources (Claude Code plugins)
    browser-buddy/
      package.json                  # Workspace member
      .claude-plugin/plugin.json    # Claude Code plugin manifest
      skills/agent-browser/SKILL.md
      agents/browser-buddy.md       # Operator subagent (Claude Code only)
    artistic-vision/
    night-shift/
      agents/                       # Agent roster (Claude Code only)
      commands/                     # /orchestrate, /drain, /abort (Claude Code only)
      skills/                       # task-triage, worktree-pipeline, task-tracking
  skills/                           # Generated symlinks for Codex and Gemini discovery
  install.sh                        # Links everything into Claude Code, Codex, and Gemini
  CLAUDE.md                         # Claude Code project context
  AGENTS.md                         # Codex project context
  GEMINI.md                         # Gemini CLI project context
```

Skills live in `plugins/<name>/skills/<name>/SKILL.md`, the canonical source of truth. The `skills/` directory at the root is a generated set of symlinks for cross-tool compatibility: `install.sh` rebuilds it, so do not hand-edit it.

## Contributing

1. Fork the repo
2. Create a feature branch
3. Follow the conventions in CLAUDE.md (no em dashes, SKILL.md under 500 lines, scripts use set -e)
4. Submit a PR

To add a new skill:

1. Create a new directory under `plugins/<skill-name>/`
2. Add the `.claude-plugin/plugin.json` manifest and a `package.json` so Bun picks it up as a workspace member
3. Create `skills/<skill-name>/SKILL.md` with YAML frontmatter
4. Add an entry to `.claude-plugin/marketplace.json`
5. Run `bash install.sh`, which regenerates the root `skills/` symlinks and installs the new skill everywhere

## License

[MIT](LICENSE) - Omnilogic Labs
