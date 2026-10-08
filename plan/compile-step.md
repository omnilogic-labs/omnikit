# Plan: compile step for per-host skills and agents

**Goal:** One templated source in `src/` compiles, via `bun run build`, into the Claude Code plugin tree plus Codex
and agy trees, and install/verify use those trees.

Check command for every task: `bun run check && bun run verify`. Base branch: `main`. bun only. No em or en dashes
in any file.

## Decisions taken in this plan (from the code as it is)

- **Layout.** Sources: `src/skills/<name>/` (SKILL.md, references/, scripts/, bin/, package.json, bun.lock copied
  as-is) and `src/agents/<role>.md`. Compiler: `scripts/build/` (`hosts.ts`, `render.ts`, `build.ts`, tests).
- **Claude tree** stays `plugins/omnilogic-labs/{skills,agents}`, generated and **committed** (the marketplace
  installs from git). Everything else in the plugin (`bin/`, `evals/`, `hooks/`, `types/`, `.claude-plugin/`,
  README) stays hand-kept.
- **Codex and agy trees** are `dist/codex/{skills,agents}` and `dist/agy/{skills,agents}`, **gitignored**, built by
  `bun run build` and by `install.sh` before it links. Reason: they would triple-commit artistic-vision's scripts,
  and `bin/art` already finds the repo-root `node_modules` by walking up from `realpath "$0"`, which works from
  `dist/<host>/skills/...` because `dist/` sits inside the repo. Non-template files are copied, not symlinked
  (Windows checks symlinks out as text files).
- **Root `skills/` (what `npx skills` installs)** becomes a committed, generated portable tree, not symlinks
  (owner decision). `skills/<name>/SKILL.md` keeps only `name` and `description` and a short body: read the file
  for your platform (`platforms/claude.md` for Claude Code, `platforms/codex.md` for Codex,
  `platforms/agy.md` for Antigravity, `platforms/codex.md` for any other agent), and ignore the other platform
  files. Each `platforms/<host>.md` is that host's fully rendered SKILL.md body (no frontmatter). Supporting
  files: only .md files are templated, so scripts/, bin/, package.json etc. are always shared, copied once. A
  rendered .md that is identical for every host is emitted once at its usual path; one that differs is emitted
  as `platforms/<host>/<relpath>` (for example `platforms/codex/references/hosts.md`) and not at the usual path.
  The dispatcher body carries one rule for this: "Paths in your platform file are relative to this folder. When
  `platforms/<host>/<path>` exists, read it instead of `<path>`." No link rewriting. Root `package.json`
  workspaces stay on the plugin tree (one `bun install`).
- **Template syntax.** `{{name}}` vars, resolved per host: `{{tier.deep}}`, `{{tier.fast}}`, `{{effort.deep}}`,
  `{{effort.fast}}`, `{{tool.<key>}}` (dispatch tool names), `{{host.name}}`, `{{agents.dir}}` (path from a skill
  folder to the role files), plus cross-host `{{<host>.tier.deep}}` etc. for models.md's table. Line-level blocks
  `<!-- @if claude -->` / `<!-- @if codex,agy -->` ... `<!-- @endif -->`, no nesting. Unknown var, unknown host,
  unbalanced or nested block: build fails naming file and line. Directive lines are dropped from output.
- **OS axis (owner request).** OS values `linux`, `wsl`, `macos`, `windows` (Windows means Git Bash), in
  `scripts/build/os.ts`, a sibling of `hosts.ts`, each with a label (`On Linux:`, `On WSL:`, `On macOS:`,
  `On Windows (Git Bash):`) and vars (`{{os.name}}`, `{{os.shell}}`, `{{os.home}}`, `{{os.tmp}}`, extendable).
  A directive takes up to two space-separated comma lists, one per axis, in any order: `@if windows`,
  `@if linux,wsl`, `@if codex,agy windows` (host in {codex, agy} AND os is windows). Commas are OR within an
  axis. Unknown token, two lists on the same axis, or more than two lists is a build error. Trees built on the
  user's machine (`dist/codex`, `dist/agy`) render for the exact OS install.sh detects (`--os <value>`). Committed
  trees (Claude plugin, root `skills/`) render **any-OS**: every OS block is kept, preceded by its label line
  (`On Linux and WSL:` for a list), and `{{os.*}}` outside an OS block is a build error there. Leave room, but do
  not build now, for a later Claude-plugin `platforms/<os>.md` dispatcher.
- **Agent source frontmatter:** `name`, `description`, `tier: deep|fast`, optional `models: { claude: haiku }`
  (per-host override for non-tier models such as browser-buddy and external-runner), optional
  `hosts: [claude]` (default all; external-runner is Claude-only because its tool exists only in the plugin),
  and Claude-only keys `effort`, `tools`, `skills` passed through to the Claude output only.
- **Agent outputs.** Claude: current .md shape with `model: <tier model or override>`. Codex:
  `dist/codex/agents/<role>.toml` with `name`, `description`, `developer_instructions` (body), `model`,
  `model_reasoning_effort`. agy: `dist/agy/agents/<role>.md` with `model: pro|flash|inherit`. Codex and agy outputs
  also get a `<role>.md` body copy so the hosts.md "read the file, paste the body" path keeps working.
- **Prettier.** The build runs prettier (repo config) over every emitted .md/.json so output is check-clean and
  deterministic. `src/` is formatted like any source; `dist/` goes in `.prettierignore`.

## Tasks

### host-facts

- **Goal:** Confirm three host behaviours on the installed CLIs and record them where later tasks read them.
- **Files:** `plan/compile-step-facts.md` (new; only this file).
- **Steps:** In a scratch HOME-like setup (or a temp skill name you remove afterwards), check with `codex` 0.161 and
  `agy` 1.3.1: (a) does agy load a SKILL.md whose frontmatter has an unknown key (`license`, `metadata`, a made-up
  `x-test`), or warn/skip it; (b) does Codex read `~/.codex/skills` as well as `~/.agents/skills`, and which wins on
  a duplicate; (c) does Codex load a custom agent from `~/.codex/agents/<name>.toml` with the fields above, what the
  exact field names are, and how a session invokes it; (d) which frontmatter keys an agy agent file in
  `~/.gemini/config/agents/` accepts (name, description, model, tools?). Use `codex --help`, `codex exec`, `agy -p
... --mode plan --sandbox` and each CLI's docs (`ctx7` if available). Clean up every test file.
- **Tier:** fast
- **Depends on:** none
- **Acceptance criteria:**
  1. `plan/compile-step-facts.md` exists and has one section per question (a) to (d), each ending in a line
     `Answer: yes|no|<value>` and the exact command run as evidence.
  2. Section (c) states either the exact TOML field names Codex accepted or `Answer: no` (then the fallback is the
     body-copy path).
  3. `ls ~/.codex/agents ~/.gemini/config/agents ~/.agents/skills ~/.gemini/config/skills 2>/dev/null` shows no
     test entries left behind (compare with the listing recorded at the start of the file).
  4. `bun run check && bun run verify` passes.

### compiler

- **Goal:** Build the compiler and host table as a standalone, tested tool that can emit all three trees from a
  given source dir into a given out dir.
- **Files:** `scripts/build/` (new: `hosts.ts`, `render.ts`, `build.ts`, `build.test.ts`, `fixtures/`),
  `package.json` (`scripts.build`, `scripts.build:check`, `scripts.test`).
- **Steps:** `hosts.ts` exports the table: claude (deep `opus`, fast `sonnet`), codex (deep `gpt-6.1-sol` effort
  `high`, fast `gpt-6-luna` effort `medium`), agy subagent (deep `pro`, fast `flash`) and agy CLI /
  external_worker (deep `gemini-3.1-pro-high`, fast `gemini-3.8-flash-medium`), plus tool names per host
  (claude: Agent tool, `subagent_type`, SendMessage, external_worker tool name; codex: `spawn_agent`; agy:
  `invoke_subagent`). `render.ts`: pure function (text, host, vars) -> text or error with file:line. `build.ts`:
  CLI `bun scripts/build/build.ts [--src src] [--out .] [--check]`; emits `plugins/omnilogic-labs/{skills,agents}`
  (wiping only those two dirs), `dist/codex`, `dist/agy`; renders .md files, copies everything else byte for byte
  (keep exec bits); filters skill frontmatter to portable keys for hosts that need it (default keep all; make the
  per-host key list a field in `hosts.ts` so host-facts can tighten it); emits agent files per the decisions
  above; runs prettier on emitted text. `--check` builds into a temp dir and exits 1 listing every path whose
  content differs from the committed Claude tree. Tests cover vars, cross-host vars, `@if` single and multi host,
  every error case, frontmatter filtering, TOML escaping of a body with quotes and backslashes, and that a file
  without directives renders byte-identical.
- **Tier:** deep
- **Depends on:** none
- **Acceptance criteria:**
  1. `bun test scripts/build` passes, and the test file contains at least one test per error case: unknown var,
     unknown host in `@if`, `@endif` without `@if`, unclosed `@if`, nested `@if`.
  2. `bun scripts/build/build.ts --src scripts/build/fixtures/src --out "$(mktemp -d)"` exits 0 and the out dir
     contains `plugins/omnilogic-labs/agents/*.md`, `dist/codex/agents/*.toml`, `dist/agy/agents/*.md`.
  3. A fixture with `{{nope}}` makes the build exit non-zero with a message naming the fixture file and line
     (covered by a test; also run by hand and inspect stderr).
  4. The emitted Codex TOML parses: `bun -e 'console.log(Bun.TOML.parse(await Bun.file(process.argv[1]).text()))'
<file>` prints an object with `name`, `description`, `developer_instructions`, `model`,
     `model_reasoning_effort`.
  5. `grep -rnP '[\x{2013}\x{2014}]' scripts/build` prints nothing.
  6. `bun run check && bun run verify` passes (the repo's real trees are untouched by this task).

### migrate-sources

- **Goal:** Move the real skills and agents into `src/`, make the plugin tree generated, and prove the Claude
  output is unchanged.
- **Files:** `src/` (new), `plugins/omnilogic-labs/skills/`, `plugins/omnilogic-labs/agents/`, `.gitignore`,
  `.prettierignore`, `scripts/build/hosts.ts` (frontmatter key list only, from host-facts).
- **Steps:** `git mv` each skill and agent into `src/` (history follows), then regenerate the plugin tree with
  `bun run build`. In agent sources replace `model:` with `tier:` (planner deep; builder, verifier fast;
  browser-buddy and external-runner `tier: fast` plus `models: { claude: haiku }`; external-runner
  `hosts: [claude]`). Turn `coordinator/references/models.md` into a template whose table comes from cross-host
  vars, so `hosts.ts` is the only place model names live. Apply host-facts (a) and (d) to the frontmatter key
  lists. Add `dist/` to `.gitignore` and `.prettierignore`. Do not convert any other prose yet. Skip nested
  `node_modules` when copying.
- **Tier:** fast
- **Depends on:** host-facts, compiler
- **Acceptance criteria:**
  1. `git diff main --stat -- plugins/omnilogic-labs/skills plugins/omnilogic-labs/agents` shows no changed
     lines (the regenerated Claude tree is byte-identical to main), or only whitespace-free changes to `model:`
     lines; inspect `git diff main -- plugins/omnilogic-labs` to confirm.
  2. `bun run build:check` exits 0 right after `bun run build`.
  3. `grep -rnE 'opus|sonnet|gpt-6|gemini-3' src/agents src/skills/coordinator | grep -v 'models:'` prints nothing
     (host tier model names live only in `scripts/build/hosts.ts` and agent `models:` overrides; product model ids
     in artistic-vision and primer are out of scope).
  4. `ls dist/codex/agents dist/agy/agents dist/codex/skills dist/agy/skills` lists every role (no
     external-runner under codex/agy) and all 7 skills; `git status --porcelain dist` prints nothing.
  5. `find dist -name node_modules` prints nothing.
  6. `claude plugin validate --strict plugins/omnilogic-labs` passes.
  7. `bun run check && bun run verify` passes.

### os-axis

- **Goal:** Add the OS axis to the compiler: OS table, combined host and OS directives, `--os`, and the labelled
  any-OS rendering.
- **Files:** `scripts/build/os.ts` (new), `scripts/build/render.ts`, `scripts/build/build.ts`,
  `scripts/build/build.test.ts`, `scripts/build/fixtures/` (not `hosts.ts`, which migrate-sources owns in the
  same wave).
- **Steps:** Follow the OS axis decision above. `render(text, { host, os })` where `os` is one of the four values
  or `any`. Exact OS: keep matching blocks, drop the rest, resolve `{{os.*}}`. `any`: keep every block whose host
  list matches, emit the label line (then the block body) for OS-conditioned blocks, and fail on `{{os.*}}` outside
  an OS block (inside one, resolve with that block's OS when it names exactly one OS, else fail). `build.ts`: add
  `--os linux|wsl|macos|windows|any` (default `any`); committed trees always render `any`; `dist/<host>` uses
  `--os` and writes the value to `dist/<host>/.os`; `--check` compares committed trees only (any-OS). Sources
  without OS blocks must render byte-identical to before.
- **Tier:** deep
- **Depends on:** compiler
- **Acceptance criteria:**
  1. `bun test scripts/build` passes and includes tests for: each single OS, `@if linux,wsl`, a combined
     `@if codex windows` block rendered for (codex, windows), (codex, linux) and (agy, windows), the any-OS label
     for a one-OS and a two-OS block, `{{os.shell}}` resolved per OS, `{{os.shell}}` outside a block failing under
     `any`, and every error case below.
  2. `@if beos`, `@if codex,windows` (mixed axes in one list), `@if codex agy` (two host lists) and
     `@if codex windows linux` (three lists) each fail with file and line (covered by tests).
  3. `bun scripts/build/build.ts --src scripts/build/fixtures/src --out "$(mktemp -d)" --os beos` exits non-zero
     and stderr names the allowed values.
  4. With a fixture holding a `<!-- @if windows -->` block: `--os linux` output lacks the block body, `--os windows`
     output has it with no label, and the committed-tree output (any-OS) has `On Windows (Git Bash):` followed by
     the body. Inspect the three out dirs.
  5. `cat <out>/dist/codex/.os` prints the `--os` value.
  6. `grep -rnP '[\x{2013}\x{2014}]' scripts/build` prints nothing.
  7. `bun run check && bun run verify` passes.

### install-verify

- **Goal:** Make install.sh, verify-install.sh and skill-stats.sh build first and use the per-host trees, including
  agent files.
- **Files:** `install.sh`, `scripts/verify-install.sh`, `scripts/skill-stats.sh`.
- **Steps:** install.sh: detect the OS (`MINGW*|MSYS*|CYGWIN*` -> windows, `Darwin` -> macos, Linux with
  `microsoft` in `/proc/version` -> wsl, else linux); after deps, run `bun run build -- --os <detected>` (skip
  under `--check`, which instead runs `bun run build:check`, reports `stale-build`, and reports `wrong-os` when
  `dist/<host>/.os` differs from the detected OS); link `~/.agents/skills/<name>` (or `~/.codex/skills`, per
  host-facts b) into `dist/codex/skills/<name>` and `~/.gemini/config/skills/<name>` into `dist/agy/skills/<name>`;
  link each `dist/codex/agents/*.toml` into `~/.codex/agents/` only if host-facts (c) says yes; link each
  `dist/agy/agents/*.md` into `~/.gemini/config/agents/`; prune stale links of ours as today. Keep `realpath`
  rules, Windows `nativestrict` and Git Bash paths. verify-install.sh: add a `build-fresh` check
  (`bun run build:check`), point `check_links` at the dist trees, add agent-link checks for Codex and agy, read
  the skill and agent lists from `src/`. skill-stats.sh: loop over every generated SKILL.md
  (`plugins/omnilogic-labs/skills`, `dist/codex/skills`, `dist/agy/skills`), prefix the name with the host, apply
  the same budgets; apply the Claude-syntax check to codex and agy output only. Test install against a throwaway
  HOME so the real links are not pointed at a worktree. Root `skills/` is now generated by the build, not
  linked: drop `sync_repo_skills` and the `skills/` part of `repair_git_symlinks` (keep a one-time prune of old
  root symlinks if any remain). skill-stats.sh also checks the portable tree: each `skills/*/SKILL.md`
  (description at most 300 chars, portable keys only) and each `skills/*/platforms/*.md` against the 150-line
  body budget and the dash rule (whole file is the body; no frontmatter).
- **Tier:** deep
- **Depends on:** migrate-sources, portable-tree, os-axis
- **Acceptance criteria:**
  1. `H=$(mktemp -d); HOME=$H bash install.sh --agents --agy --no-deps` exits 0, and `readlink -f
$H/.agents/skills/coordinator` (or the dir host-facts chose) ends in `dist/codex/skills/coordinator` and
     `readlink -f $H/.gemini/config/skills/coordinator` ends in `dist/agy/skills/coordinator`.
  2. Same HOME: `ls $H/.gemini/config/agents` lists planner, builder, verifier, browser-buddy; `ls
$H/.codex/agents` lists their .toml files if host-facts (c) is yes, else does not exist.
  3. Same HOME: `HOME=$H bash install.sh --check --agents --agy` exits 0; after `echo x >>
src/skills/plain-writing/SKILL.md` it exits 1 and prints a `stale-build` line (revert the edit after).
  4. `bash scripts/skill-stats.sh --strict` exits 0 and its TSV has rows for all 7 skills under each of claude,
     codex, agy (21 rows) plus 7 portable dispatcher rows and 21 `skills/*/platforms/*.md` rows; appending 151
     lines to a copy of a platform file in a temp skill (or a test fixture) makes it exit 1.
     4b. On this machine (WSL), after a real-HOME-free run as in criterion 1, `cat dist/codex/.os dist/agy/.os` prints
     `wsl` twice; `HOME=$H OMNIKIT_OS=linux bash install.sh --check --agents --agy` (an override env var the
     builder adds for testing) exits 1 with a `wrong-os` line.
     4a. `grep -n 'sync_repo_skills\|ls-files -s -- skills' install.sh` prints nothing, and
     `HOME=$(mktemp -d) bash install.sh --check --agents --agy` reports no `placeholder` or `stale` line for
     the repo's `skills/`.
  5. `bash -n install.sh scripts/verify-install.sh scripts/skill-stats.sh` exits 0 and each starts with
     `#!/bin/bash` and `set -e`.
  6. After the wave merges to main and `bash install.sh` runs there: `bun run verify` prints a `pass build-fresh`
     line and no `fail` lines.
  7. `bun run check && bun run verify` passes.

### host-prose

- **Goal:** Replace the hand-written per-host prose in the coordinator skill and agents with templated blocks so
  each host reads only its own instructions.
- **Files:** `src/skills/coordinator/`, `src/agents/`, and the regenerated `plugins/omnilogic-labs/skills/coordinator/`,
  `plugins/omnilogic-labs/agents/` and `skills/coordinator/`.
- **Steps:** In `SKILL.md` Roles, and in `references/hosts.md`, wrap the Claude Code, Codex and agy sections in
  `@if` blocks and write model names as `{{tier.deep}}`/`{{tier.fast}}` and tool names as `{{tool.*}}`; use
  `{{agents.dir}}` for the role-file path. Codex section: if host-facts (c) is yes, dispatch the installed custom
  agent by name; otherwise keep "read the body and paste it". Keep the "No subagents" and "External workers"
  sections (the latter Claude-only). Keep `references/models.md` as the cross-host table. Agents: use `{{tool.*}}`
  where a body names a host tool. Keep every generated SKILL.md within budget.
- **Tier:** deep
- **Depends on:** migrate-sources, portable-tree
- **Acceptance criteria:**
  1. `bun run build && bun run build:check` exits 0.
     1a. `ls skills/coordinator/platforms/codex/references/hosts.md skills/coordinator/platforms/agy/references/hosts.md
skills/coordinator/platforms/claude/references/hosts.md` succeeds and `test ! -e
skills/coordinator/references/hosts.md` succeeds (hosts.md now differs per host).
  2. `grep -c 'spawn_agent\|invoke_subagent' plugins/omnilogic-labs/skills/coordinator/references/hosts.md` is 0;
     `grep -c 'subagent_type\|external_worker' dist/codex/skills/coordinator/references/hosts.md
dist/agy/skills/coordinator/references/hosts.md` is 0 for both.
  3. `grep -l 'gpt-6.1-sol' dist/codex/skills/coordinator/references/hosts.md` matches, and the same file in the
     Claude and agy trees does not contain `gpt-6`.
  4. `grep -rn '@if\|@endif\|{{' plugins/omnilogic-labs dist skills --include=*.md` prints nothing.
  5. `bash scripts/skill-stats.sh --strict` exits 0.
  6. `bun run check && bun run verify` passes.

### portable-tree

- **Goal:** Emit the root `skills/` portable tree from the compiler, and make the no-diff check cover it and
  compare the executable bit as well as content.
- **Files:** `scripts/build/` (build.ts, tests, fixtures; not `hosts.ts` model values), `skills/` (replaces
  the symlinks), `.prettierignore` (drop the `/skills/` line so prettier checks the generated tree).
- **Steps:** Add a fourth output to `build.ts` per the root `skills/` decision above: render each skill for all
  three hosts, write the dispatcher SKILL.md (frontmatter `name`, `description` only; body under 15 lines,
  names the host to file mapping, the "ignore other platform files" line and the `platforms/<host>/<path>` rule),
  write `platforms/<host>.md`, copy shared files once, and write per-host copies only for .md files whose render
  differs. The portable tree renders any-OS. `git rm` the old symlinks (`git rm skills/<name>`) and commit the generated dirs. Extend `--check` to
  cover `skills/` and to fail when a file's executable bit differs between the fresh build and the committed
  file (`fs.stat` mode & 0o111; on Windows fall back to `git ls-files -s` mode 100755 vs 100644). Add tests:
  dispatcher shape, a reference with a host block lands under `platforms/<host>/`, a reference without one lands
  once, an exec-bit mismatch fails `--check`. Skip nested `node_modules`.
- **Tier:** deep
- **Depends on:** migrate-sources, os-axis
- **Acceptance criteria:**
  1. `bun test scripts/build` passes and includes the four new tests named above.
  2. `git ls-files -s skills | awk '$1 == "120000"'` prints nothing (no symlinks left); `ls skills` lists all 7
     skills, each with `SKILL.md` and `platforms/claude.md`, `platforms/codex.md`, `platforms/agy.md`.
  3. For each `skills/*/SKILL.md`: frontmatter keys are exactly `name` and `description` (inspect with
     `awk '/^---$/{f++; next} f==1' <file> | grep -oE '^[a-z-]+:'`), and the body is 15 lines or fewer.
  4. `cmp <(sed '1,/^---$/{/^---$/!d}' plugins/omnilogic-labs/skills/plain-writing/SKILL.md | sed '1,/^---$/d')
skills/plain-writing/platforms/claude.md` shows no difference (the Claude platform file is the Claude body),
     or the builder records the exact equivalent command it used and its empty output.
  5. `find skills -name node_modules` prints nothing; `test -x skills/artistic-vision/bin/art` succeeds.
  6. `bun run build:check` exits 0; after `chmod -x plugins/omnilogic-labs/skills/artistic-vision/bin/art` it
     exits 1 naming that path (restore with `chmod +x` after); after `echo x >> skills/primer/SKILL.md` it exits
     1 naming that path (restore with `git checkout skills/primer/SKILL.md`).
  7. `bun run check && bun run verify` passes (verify's link checks may report the root `skills/` change only if
     install.sh still expects symlinks; if so record it for install-verify and mark that line UNVERIFIED, not
     FAIL).

### docs

- **Goal:** Document the source/output split and the build in AGENTS.md and the READMEs, and bump the version.
- **Files:** `AGENTS.md`, `README.md`, `plugins/omnilogic-labs/README.md`, `.claude-plugin/marketplace.json`,
  `plugins/omnilogic-labs/.claude-plugin/plugin.json`.
- **Steps:** AGENTS.md Layout: `src/` is the source, `plugins/omnilogic-labs/{skills,agents}` and `dist/` are
  generated, "edit src/, never generated output", `scripts/build/hosts.ts` is the one model table, `bun run build`
  after any src change. Keep AGENTS.md short (it is always loaded). README: how the build works, template syntax,
  where each host's files install, Windows notes kept. Bump version to 2.1.0 in both manifests.
- **Tier:** fast
- **Depends on:** install-verify, host-prose (also documents the portable `skills/` tree for `npx skills`)
- **Acceptance criteria:**
  1. `grep -n 'src/' AGENTS.md` shows the layout line and the never-edit-generated rule; `grep -n 'bun run build'
AGENTS.md README.md` matches in both.
  2. `jq -r .version plugins/omnilogic-labs/.claude-plugin/plugin.json` and `jq -r '.version, .plugins[0].version'
.claude-plugin/marketplace.json` all print `2.1.0`.
  3. `grep -rnP '[\x{2013}\x{2014}]' AGENTS.md README.md plugins/omnilogic-labs/README.md` prints nothing.
  4. `bun run check && bun run verify` passes.

## Waves

1. host-facts, compiler (disjoint: `plan/compile-step-facts.md` vs `scripts/build/` + `package.json`)
2. migrate-sources, os-axis (disjoint: `src/`, generated trees, `hosts.ts`, ignore files vs `os.ts`,
   `render.ts`, `build.ts`, tests, fixtures)
3. portable-tree (alone: it rewrites every generated tree's check and replaces root `skills/`)
4. install-verify, host-prose (disjoint: install/verify/stats scripts vs coordinator and agent sources and their
   generated output, including `skills/coordinator/`)
5. docs

## Risks

- **Codex custom agents may not load** from `~/.codex/agents/*.toml` on 0.161. Fallback is built in: install skips
  the TOML links and hosts.md keeps the paste-the-body path. No owner call needed unless the owner wants Codex
  agents dropped entirely.
- **`bun run verify` reads real home links.** Running `install.sh` from a worktree would point the owner's
  `~/.agents/skills` at a worktree that is later removed. Builders test install with a throwaway HOME; the real
  `bash install.sh` runs once on main after wave 4 merges (criterion install-verify 6). Wave 4 verify on the
  integration branch may report link checks stale until then; the coordinator should run `bash install.sh` on
  main right after the fast-forward.
- **OS detection** can misread WSL1 vs WSL2 or a Cygwin shell; `OMNIKIT_OS` lets the owner override it.
  Today's sources have no OS blocks, so the OS axis changes no output until someone adds one.
- **Prettier on generated output** could make `build:check` flap if the prettier version changes; it is pinned
  through bun.lock.
- **`npx skills` portable tree** (owner decided): an agent might read the wrong platform file or miss the
  `platforms/<host>/<path>` rule. The dispatcher body is the only guard; keep it short and explicit. Agents other
  than the three hosts get `platforms/codex.md`; change the default in one place if the owner prefers another.
- **Windows clones** made before this change have `skills/` as placeholder files; a `git pull` replaces them with
  real dirs. install-verify keeps a one-time prune for leftover root symlinks.
- **Codex scanning `dist/`** when Codex runs inside this repo: it already sees the repo's root `skills/`; `dist/` adds a second copy only if Codex scans arbitrary repo dirs. host-facts should note any
  duplicate it sees.
