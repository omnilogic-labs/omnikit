# Omnikit

A Claude Code plugin marketplace that also installs its skills for Codex and Antigravity (agy). By [Omnilogic Labs](https://github.com/omnilogic-labs).

## Skills

One plugin, `omnilogic-labs`, carries every skill and agent. In Claude Code they are namespaced `omnilogic-labs:<name>`.

- `agent-browser`: drive Vercel's [agent-browser](https://github.com/vercel-labs/agent-browser) CLI
- `artistic-vision`: Gemini image generation and editing, Sharp local processing
- `coordinator`: run multi-step work through planner, builder, and verifier agents
- `onepassword`: read secrets through the `op` CLI
- `plain-writing`: write prose a reader understands on the first pass
- `primer`: turn a product idea into a build brief and task files
- `render`: Render.com blueprints, SSH, and REST API

Agents: `planner`, `builder`, `verifier`, `browser-buddy`, and `external-runner`.

## Install

Clone, preview, then install. The installer is safe to re-run.

```bash
git clone https://github.com/omnilogic-labs/omnikit.git
cd omnikit
bash install.sh --dry-run   # print what would change, change nothing
bash install.sh
```

| Tool            | How it installs                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Claude Code     | `omnilogic-labs@omnikit` plugin from this clone's `omnikit` marketplace                             |
| Codex CLI       | skill links in `~/.agents/skills`, agent links in `~/.codex/agents`, into `dist/codex`              |
| Antigravity CLI | skill links in `~/.gemini/config/skills`, agent links in `~/.gemini/config/agents`, into `dist/agy` |

The installer runs `bun run build` first, then links. It picks every tool it finds on PATH and says which ones it skipped. Other flags: `--claude`, `--codex`, `--agy` (one tool only), `--browser` (also set up agent-browser and Chrome), `--force`, `--check`, `--help`. `OMNIKIT_OS=linux|wsl|macos|windows` overrides the detected OS. Re-run after a `git pull` or any `src/` edit, and restart open Claude Code, Codex, and agy sessions so they rescan.

Run the installer from the main checkout, not a worktree: Claude Code's marketplace points at whichever clone ran it.

### Windows

Run `bash install.sh` from **Git Bash**. It works there with these prerequisites:

- **Developer Mode on** (Settings, System, For developers), or an elevated Git Bash. The Codex and agy installs are symlinks, and Windows only lets a normal user create symlinks in Developer Mode. The installer checks first and stops with this advice rather than falling back. Plain `ln -s` in Git Bash would silently copy the folder instead, so the installer forces real links (`MSYS=winsymlinks:nativestrict`).
- **Git for Windows**, **bun**, and, for `bun run verify`, **jq** (`winget install jqlang.jq`, then open a new shell).

What the installer handles for you on Windows:

- Git for Windows clones with `core.symlinks=false`. The committed trees hold no links, so the clone is unaffected; the installer sets `core.symlinks=true` anyway and `git status` stays clean.
- The Claude Code marketplace is added by its Windows path (`D:\...\omnikit`). An `omnikit` marketplace that points at GitHub or another clone is removed and added again from this clone.

What the agents need to know, and the skills now say it where the scripts are called:

- The helpers (`bin/art`, `bin/op-secret`, `bin/render-api`, `bin/render-ssh`, `scripts/wt`) are bash scripts with no extension. **Never run one directly from PowerShell or cmd.** Windows treats the file as a document and opens an "Open with" dialog, and the agent waits on a command that never finishes. Run them from Git Bash, or from PowerShell as `& "$env:ProgramFiles\Git\bin\bash.exe" <path> ...`.
- A plain `bash` in PowerShell is often WSL (`C:\Windows\System32\bash.exe` comes first on a stock PATH), which cannot read `C:\` paths. Codex picks Git Bash on its own; agy and other PowerShell-first agents need the explicit path above.
- Claude Code keeps `GEMINI_API_KEY` in its `settings.json` `env`, where Codex and agy cannot see it. For `artistic-vision` Gemini commands in those tools, set it as a user environment variable or follow `skills/artistic-vision/references/windows-powershell.md`.

Checked on Windows 11 with Claude Code 2.1.294, Codex CLI 0.161.0, and agy 1.3.1: `bun run verify:ask` passes 17 of 17, each tool runs `art info` through its skill link, and `external_worker` completes jobs for the `fake`, `codex`, and `agy` engines.

## Verify

```bash
bun run verify       # install.sh --check, Claude Code plugin state and init event, skill links
bun run verify:ask   # the same, plus one model query each to claude, codex, and agy
```

Success is exit 0 and a last stdout line of `summary pass=<n> fail=0 skip=0`. Each check prints one `pass`, `fail`, or `skip` line, and a tool not on PATH counts as `skip`. The checks run in groups:

- Build: `build-fresh` runs `bun run build:check`, so generated trees that differ from `src/` fail.
- Install: `install-check` runs `install.sh --check` and fails on missing, stale, legacy, or nested links and on a `dist/` built for another OS.
- Claude Code: the marketplace points at the main checkout, the plugin is enabled with no stale copies, and the `system/init` event of `claude -p --output-format stream-json --verbose` lists every skill and agent as `omnilogic-labs:<name>`, with no unprefixed copies and the `mcp__omnilogic-labs__external_worker` tool.
- Codex and agy: every skill is linked, no skill folder holds a nested `SKILL.md`, no legacy links remain, and every agent is linked. With `--ask`, one model query per tool must name every skill.

What each tool should see:

- Claude Code: all 7 skills and 5 agents (`planner`, `builder`, `verifier`, `browser-buddy`, `external-runner`).
- Codex: the 7 skills, as linked from `dist/codex`, and 4 agents (no `external-runner`, which is Claude only). Ask with `codex exec -s read-only "list your skills" </dev/null`.
- Antigravity: the 7 skills, unprefixed, and the same 4 agents. Ask with `agy -p "list your skills" --mode plan --sandbox </dev/null`.

`bun run build` on its own writes `dist/` for `OMNIKIT_OS` if set, else the OS already recorded in `dist/*/.os`, else the detected OS, so `install-check` does not report `wrong-os` after it. `--os` overrides all three (`--os any` keeps every OS block). The committed trees (the Claude plugin and root `skills/`) are always any-OS.

Troubleshooting:

- agy lists no omnikit skills: it reads `~/.gemini/config/skills`, not `~/.agents/skills`. Run `bash install.sh --agy`.
- `agy plugin import claude` is not used: it only scans real directories directly under `~/.claude/plugins` (symlinks and the plugin cache are skipped), copies them so edits need `--force` to re-import, brings in the 5 agents as no subagents and the Claude-only hook, and keeps skill names unprefixed. The symlinks stay live on edit.
- agy drops one skill silently: its YAML parser is strict, so a `description:` with an unquoted `: ` fails. Use a `>-` block. The error is in `~/.gemini/antigravity-cli/cli.log`.
- Codex lists extra skills such as `core`, `dogfood`, or a bare `agent-browser`: Codex walks skill folders several levels deep and finds the SKILL.md files inside a skill's `node_modules`. `bunfig.toml` hoists dependencies to the root, and `bash install.sh` removes any per-skill `node_modules` left from before.
- Claude Code shows a skill twice, once without the prefix: a legacy link in `~/.claude/skills` or `~/.claude/agents`. `bash install.sh` removes links into this repo and leaves everything else alone.
- `claude-marketplace` fails: the marketplace points at another clone or a worktree. Run `bash install.sh --claude` from the main checkout.

## Development

This repo is a [Bun](https://bun.com) workspace. To get started:

```bash
bun install
```

### The build

Skills and agents are written once under `src/` and compiled for each host. Edit `src/` and `scripts/build/hosts.ts` (models, efforts, tool names) or `scripts/build/os.ts` (OS values). Never edit the generated trees: `plugins/omnilogic-labs/{skills,agents}`, root `skills/`, and `dist/`.

```bash
bun run build         # regenerate every tree
bun run build:check   # exit 1 and list generated files that differ from a fresh build
bun test              # run the compiler tests (bun run test)
```

What it writes:

- `plugins/omnilogic-labs/`: the Claude Code plugin, committed, rendered for every OS.
- `skills/`: the portable copy `npx skills` installs, committed. Each skill is a short dispatcher `SKILL.md` plus `platforms/<host>.md` bodies, so one install serves Claude Code, Codex, and agy.
- `dist/codex` and `dist/agy`: gitignored, rendered for this machine's OS (recorded in `dist/<host>/.os`). Codex agents are TOML; agy agents are Markdown.

Template syntax, in any `src/` Markdown file:

- `{{tier.deep}}`, `{{cli.fast}}`, `{{tool.agent}}`, `{{host.label}}`, `{{os.shell}}`: values for the host being rendered. `{{os.*}}` works only inside a one-OS `@if` block (such as `<!-- @if windows -->`), because the committed any-OS trees have no single OS and the build fails elsewhere. `{{codex.tier.deep}}` reads another host's value. An unknown name fails the build.
- `<!-- @if codex -->` ... `<!-- @endif -->` keeps the lines between only for that host. `<!-- @if claude,agy -->` is OR. A host list and an OS list may be combined with a space: `<!-- @if codex windows -->`. Blocks do not nest.
- OS names are `linux`, `wsl`, `macos`, `windows`. In the committed any-OS trees an OS block is kept under a label line such as `On Windows (Git Bash):`; in `dist/` only the matching OS stays.
- Agent frontmatter may carry `tier: deep|fast`; the build turns it into each host's model.

`bun run verify` also runs the build check, so a stale tree fails it. Commit regenerated trees with the `src/` change that caused them.

Each plugin under `plugins/*` is a workspace member. The root package is private and not published to npm; distribution happens via the Git repo itself (see Install above).

## Repository Structure

```
omnikit/
  AGENTS.md                         # Layout, skills, conventions (CLAUDE.md imports it)
  .claude-plugin/marketplace.json   # Claude Code marketplace manifest
  src/                              # Source of every skill and agent: edit here
  scripts/build/                    # Compiler, hosts.ts and os.ts tables, tests
  plugins/omnilogic-labs/           # The plugin: generated skills/ and agents/, plus bin/, evals/
  skills/                           # Generated portable copy for npx skills
  dist/                             # Generated Codex and agy trees (gitignored)
  install.sh                        # Installs into Claude Code, Codex, and agy
  scripts/verify-install.sh         # Checks what each tool registered
  scripts/skill-stats.sh            # Token and size budget check
```

## Contributing

Follow the conventions in AGENTS.md, run `bun run build`, `bun run check`, and `bun run budget`, and open a PR.

To add a skill, create `src/skills/<name>/SKILL.md` with YAML frontmatter, then run `bun run build` and `bash install.sh`.

## License

[MIT](LICENSE) - Omnilogic Labs
