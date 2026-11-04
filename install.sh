#!/bin/bash
# Install the omnilogic-labs skills into the agent tools on this machine.
#
#   Claude Code   installs the omnilogic-labs plugin from this clone's
#                 marketplace (omnikit), and removes the per-skill symlinks
#                 that older versions of this script created.
#   Codex         gets one symlink per skill in ~/.agents/skills and one per
#                 agent in ~/.codex/agents, pointing into dist/codex, the tree
#                 `bun run build` renders for this machine's OS.
#   agy           (Antigravity CLI) gets the same from dist/agy, in
#                 ~/.gemini/config/skills and ~/.gemini/config/agents. It does
#                 not read ~/.agents/skills.
#
# The full kit also links plugins/omnilogic-labs/bin/omsg into ~/.local/bin and
# merges the omsg hooks into Codex's hooks.json and agy's hooks.json (only the
# omsg entries; any other hook stays). Codex asks you to trust new hooks once
# in its /hooks screen; this script never bypasses that.
#
# --kit <name> installs one smaller kit instead (plugins/omnilogic-labs-<name>):
# its plugin for Claude Code, and only its skills and agents for Codex and agy.
# One kit at a time: installing a kit removes the whole plugin, and the default
# install removes any kit.
#
# The build runs first, so an edit under src/ goes live on the next run.
# OMNIKIT_OS=linux|wsl|macos|windows overrides the detected OS.
#
# Safe to re-run. Status goes to stderr. Machine output (--check findings and
# --dry-run commands) goes to stdout.
set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd -P)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
CODEX_SKILLS_DIR="${CODEX_HOME:-$HOME/.codex}/skills"
CODEX_AGENTS_DIR="${CODEX_HOME:-$HOME/.codex}/agents"
AGENTS_SKILLS_DIR="$HOME/.agents/skills"
AGY_SKILLS_DIR="$HOME/.gemini/config/skills"
AGY_AGENTS_DIR="$HOME/.gemini/config/agents"
CODEX_HOOKS="${CODEX_HOME:-$HOME/.codex}/hooks.json"
AGY_HOOKS="$HOME/.gemini/config/hooks.json"
BIN_DIR="$HOME/.local/bin"
OMSG_SRC="$REPO_ROOT/plugins/omnilogic-labs/bin/omsg"
SKILLS_SRC="$REPO_ROOT/plugins/omnilogic-labs/skills"
DIST="$REPO_ROOT/dist"
MARKETPLACE="omnikit"
PLUGIN="omnilogic-labs"
KIT=""

DO_CLAUDE=false
DO_AGENTS=false
DO_AGY=false
TARGETED=false
DEPS=true
BROWSER=false
DRY_RUN=false
CHECK=false
FORCE=false

n_link=0
n_ok=0
n_prune=0
n_conflict=0
n_problem=0

usage() {
  cat >&2 << 'USAGE'
Usage: bash install.sh [options]

Installs this repo's skills into the agent tools on this machine.

Targets (default: every tool found on PATH):
  --claude          Claude Code: install the omnilogic-labs plugin from the
                    omnikit marketplace in this clone, remove legacy links
  --agents          Codex: link each skill into ~/.agents/skills and each
                    agent into ~/.codex/agents (--codex is an alias)
  --agy             Antigravity CLI: link each skill into
                    ~/.gemini/config/skills and each agent into
                    ~/.gemini/config/agents

Kit (default: everything):
  --kit <name>      install one kit instead of everything: the
                    omnilogic-labs-<name> plugin for Claude Code, and only that
                    kit's skills and agents for Codex and agy. Installing a kit
                    removes the whole plugin, and installing without --kit
                    removes any kit. Kits: essentials

Options:
  --check           report missing, stale, and legacy links, a stale build
                    (stale-build) and a dist/ built for another OS (wrong-os);
                    change nothing; exit 1 if any are found
  -n, --dry-run     print the external commands that would run, change nothing
  --no-deps         skip "bun install"
  --browser         also run setup-browser-buddy.sh (downloads Chrome)
  --force           move aside a real file or directory blocking a link
  -h, --help        this message

Environment:
  OMNIKIT_OS        linux, wsl, macos or windows; overrides OS detection
USAGE
}

say() { echo "$*" >&2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --claude) DO_CLAUDE=true && TARGETED=true ;;
    --agents | --codex) DO_AGENTS=true && TARGETED=true ;;
    --agy) DO_AGY=true && TARGETED=true ;;
    --kit)
      if [ -z "${2:-}" ]; then
        say "error: --kit needs a name"
        usage
        exit 1
      fi
      KIT="$2"
      shift
      ;;
    --kit=*) KIT="${1#--kit=}" ;;
    --check) CHECK=true ;;
    --no-deps) DEPS=false ;;
    --deps) DEPS=true ;;
    --browser) BROWSER=true ;;
    --force) FORCE=true ;;
    -n | --dry-run) DRY_RUN=true ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      say "error: unknown option $1"
      usage
      exit 1
      ;;
  esac
  shift
done

has() { command -v "$1" > /dev/null 2>&1; }

# The kit's plugin tree holds exactly the skills and agents it carries, so it
# also tells Codex and agy which links to make. "full" means everything.
[ "$KIT" = full ] && KIT=""
KIT_DIR=""
if [ -n "$KIT" ]; then
  PLUGIN="omnilogic-labs-$KIT"
  KIT_DIR="$REPO_ROOT/plugins/$PLUGIN"
  if [ ! -f "$KIT_DIR/.claude-plugin/plugin.json" ]; then
    say "error: no kit named $KIT ($KIT_DIR/.claude-plugin/plugin.json not found)"
    exit 1
  fi
fi
PLUGIN_ID="$PLUGIN@$MARKETPLACE"

# in_kit <skills|agents> <entry-name>: true when the chosen kit carries this
# generated skill folder or agent file (any extension). Always true without a kit.
in_kit() {
  [ -n "$KIT_DIR" ] || return 0
  case "$1" in
    skills) [ -d "$KIT_DIR/skills/$2" ] ;;
    agents) [ -f "$KIT_DIR/agents/${2%.*}.md" ] ;;
  esac
}

# Windows (Git Bash, MSYS2, Cygwin). Plain `ln -s` there silently copies the
# directory instead of linking it, so the copy goes stale on the next edit and
# fails the symlink test on the next run. nativestrict makes a real Windows
# symlink or fails loudly. Real symlinks need Developer Mode (or an elevated
# shell); Codex and agy are native Windows programs and follow them.
IS_WINDOWS=false
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*)
    IS_WINDOWS=true
    export MSYS="winsymlinks:nativestrict${MSYS:+ $MSYS}"
    export CYGWIN="winsymlinks:nativestrict${CYGWIN:+ $CYGWIN}"
    ;;
esac

# detect_os: the OS the dist/ trees are rendered for.
detect_os() {
  if [ -n "${OMNIKIT_OS:-}" ]; then
    echo "$OMNIKIT_OS"
    return 0
  fi
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) echo windows ;;
    Darwin) echo macos ;;
    Linux)
      if grep -qi microsoft /proc/version 2> /dev/null; then echo wsl; else echo linux; fi
      ;;
    *) echo linux ;;
  esac
}
OS="$(detect_os)"
case "$OS" in
  linux | wsl | macos | windows) ;;
  *)
    echo "error: OMNIKIT_OS must be linux, wsl, macos or windows (got $OS)" >&2
    exit 1
    ;;
esac

# native_path <path>: the path as Windows tools print it (D:\x\y) on Windows,
# unchanged elsewhere.
native_path() {
  if $IS_WINDOWS && has cygpath; then cygpath -w "$1"; else echo "$1"; fi
}

# can_symlink: true when this shell can create a real symlink.
can_symlink() {
  local tmp ok=1
  tmp="$(mktemp -d)"
  mkdir "$tmp/target"
  if ln -s "$tmp/target" "$tmp/link" 2> /dev/null && [ -L "$tmp/link" ]; then ok=0; fi
  rm -rf "$tmp"
  return "$ok"
}

windows_symlink_help() {
  say "  Windows cannot create symlinks from this shell. Turn on Developer Mode"
  say "  (Settings, System, For developers) or run Git Bash as administrator,"
  say "  then re-run: bash install.sh"
}

if ! $TARGETED; then
  has claude && DO_CLAUDE=true
  if has codex || [ -d "$AGENTS_SKILLS_DIR" ]; then DO_AGENTS=true; fi
  if has agy || [ -d "$AGY_SKILLS_DIR" ]; then DO_AGY=true; fi
fi

# --check never writes, so it also never runs an external command.
if $CHECK; then
  DRY_RUN=true
  DEPS=false
  BROWSER=false
fi

# Directories whose links count as "ours". When this script runs from a git
# worktree, links into the main clone count too.
REPO_ROOTS=("$REPO_ROOT")
if has git; then
  common="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2> /dev/null || true)"
  if [ -n "$common" ]; then
    main_root="$(cd "$common/.." 2> /dev/null && pwd -P || true)"
    if [ -n "$main_root" ] && [ "$main_root" != "$REPO_ROOT" ]; then
      REPO_ROOTS+=("$main_root")
    fi
  fi
fi

# into_repo <path>: true when the symlink <path> resolves into a repo root,
# even if its target no longer exists.
into_repo() {
  local resolved root
  resolved="$(readlink -m "$1")"
  for root in "${REPO_ROOTS[@]}"; do
    case "$resolved" in "$root" | "$root"/*) return 0 ;; esac
  done
  return 1
}

# problem <kind> <path>: one --check finding, as TSV on stdout.
problem() {
  printf '%s\t%s\n' "$1" "$2"
  n_problem=$((n_problem + 1))
}

# run <cmd> [args...]: runs an external command with its output on stderr, or
# under --dry-run prints the command on stdout instead.
run() {
  local line
  if $DRY_RUN; then
    line="$(printf '%q ' "$@")"
    echo "${line% }"
    return 0
  fi
  "$@" >&2
}

# link_into <target-dir> <source-path> <link-name>
#
# Points <target-dir>/<link-name> at <source-path>. Replaces an existing
# symlink; refuses to clobber a real file or directory unless --force, in which
# case it is moved aside with a timestamp.
link_into() {
  local dir="$1" src="$2" name="$3"
  local dst="$dir/$name" current backup

  if [ -L "$dst" ]; then
    current="$(readlink "$dst")"
    if [ "$current" = "$src" ]; then
      n_ok=$((n_ok + 1))
      return 0
    fi
    if $CHECK; then
      problem stale "$dst"
      return 0
    fi
    say "  replace  $name (was -> $current)"
  elif [ -e "$dst" ]; then
    if $CHECK; then
      problem conflict "$dst"
      return 0
    fi
    if $FORCE; then
      backup="$dst.replaced-$(date +%Y%m%d%H%M%S)"
      $DRY_RUN || mv "$dst" "$backup"
      say "  backup   $name -> $(basename "$backup")"
    else
      say "  CONFLICT $name: $dst exists and is not a symlink. Re-run with --force to move it aside."
      n_conflict=$((n_conflict + 1))
      return 0
    fi
  elif $CHECK; then
    problem missing "$dst"
    return 0
  fi

  $DRY_RUN || ln -sfn "$src" "$dst"
  say "  link     $name"
  n_link=$((n_link + 1))
}

# prune_dir <kind> <target-dir> [keep-name...]
#
# Removes symlinks in <target-dir> that point into this repo and are not in the
# keep list. Links pointing anywhere else are left alone. Under --check each
# one is reported as <kind> instead.
prune_dir() {
  local kind="$1" dir="$2"
  shift 2
  local keep=" $* " entry name

  [ -d "$dir" ] || return 0

  for entry in "$dir"/* "$dir"/.[!.]*; do
    [ -L "$entry" ] || continue
    name="$(basename "$entry")"
    case "$keep" in *" $name "*) continue ;; esac
    into_repo "$entry" || continue
    if $CHECK; then
      problem "$kind" "$entry"
      continue
    fi
    $DRY_RUN || rm -f "$entry"
    say "  prune    $entry ($kind link into the repo)"
    n_prune=$((n_prune + 1))
  done
}

# dist_entries <dir> <pattern>: the generated entries in <dir> matching
# <pattern>, one path per line.
dist_entries() {
  local dir="$1" pattern="$2"
  [ -d "$dir" ] || return 0
  find "$dir" -mindepth 1 -maxdepth 1 -name "$pattern" | sort
}

# link_all <target-dir> <src-dir> <pattern> <skills|agents>: links each entry
# of <src-dir> matching <pattern> (and in the chosen kit, if any) into
# <target-dir>, then prunes links of ours in <target-dir> that are no longer
# generated or not in the kit.
link_all() {
  local dir="$1" srcdir="$2" pattern="$3" kind="$4" names=() src name
  $DRY_RUN || mkdir -p "$dir"
  while IFS= read -r src; do
    name="$(basename "$src")"
    in_kit "$kind" "$name" || continue
    names+=("$name")
    link_into "$dir" "$src" "$name"
  done < <(dist_entries "$srcdir" "$pattern")
  prune_dir stale "$dir" "${names[@]}"
}

# Root skills/ used to hold committed symlinks into the plugin. It is now a
# generated tree of real directories; remove any old links a clone still has.
prune_root_skill_links() {
  prune_dir legacy "$REPO_ROOT/skills"
}

# build_dist: renders src/ into the plugin, the root skills/ tree, and
# dist/<host> for this OS. Under --check, compares instead.
build_dist() {
  local out host os_file got
  say ""
  if $CHECK; then
    say "Build (check, OS $OS)"
    if ! has bun; then
      problem no-bun "bun not on PATH; cannot check the build"
      return 0
    fi
    if ! out="$(cd "$REPO_ROOT" && bun run --silent build:check 2> /dev/null)"; then
      problem stale-build "${out//$'\n'/; }"
    fi
    for host in codex agy; do
      os_file="$DIST/$host/.os"
      if [ ! -f "$os_file" ]; then
        problem missing-build "$DIST/$host"
        continue
      fi
      got="$(tr -d '[:space:]' < "$os_file")"
      [ "$got" = "$OS" ] || problem wrong-os "$DIST/$host built for $got, this machine is $OS"
    done
    return 0
  fi
  say "Build (bun run build -- --os $OS)"
  if ! has bun; then
    say "error: bun not found. Install it from https://bun.sh, then re-run."
    exit 1
  fi
  if $DRY_RUN; then
    run bun run build -- --os "$OS"
  else
    (cd "$REPO_ROOT" && bun run build -- --os "$OS" >&2)
  fi
}

# Claude Code installs the plugin through the marketplace, so every per-skill,
# per-agent, and per-command link from older installs has to go, or each skill
# would load twice.
remove_claude_legacy() {
  local sub
  for sub in skills agents commands; do
    prune_dir legacy "$CLAUDE_DIR/$sub"
  done
}

install_claude() {
  local plugins marketplaces id
  say ""
  say "Claude Code ($CLAUDE_DIR, plugin $PLUGIN_ID)"
  remove_claude_legacy
  $CHECK && return 0

  if ! has claude; then
    say "  claude not on PATH. Install it, then run: bash install.sh --claude"
    if ! $DRY_RUN; then return 0; fi
  fi

  plugins=""
  marketplaces=""
  if has claude; then
    plugins="$(claude plugin list --json 2> /dev/null || true)"
    marketplaces="$(claude plugin marketplace list --json 2> /dev/null || true)"
  fi

  # The marketplace must point at this clone. One added from GitHub or from
  # another clone under the same name is replaced, or `update` would keep
  # installing that copy. JSON escapes the backslashes in a Windows path.
  local here
  here="$(native_path "$REPO_ROOT")"
  here="${here//\\/\\\\}"
  if grep -Eq "\"name\": *\"$MARKETPLACE\"" <<< "$marketplaces"; then
    if grep -qF "\"$here\"" <<< "$marketplaces"; then
      run claude plugin marketplace update "$MARKETPLACE"
    else
      say "  marketplace $MARKETPLACE points elsewhere; re-adding it from this clone"
      run claude plugin marketplace remove "$MARKETPLACE"
      run claude plugin marketplace add "$(native_path "$REPO_ROOT")"
      $DRY_RUN || plugins="$(claude plugin list --json 2> /dev/null || true)"
    fi
  else
    run claude plugin marketplace add "$(native_path "$REPO_ROOT")"
  fi

  # Every other plugin of this marketplace: the whole plugin or another kit, and
  # plugins from earlier versions (one per skill group). One kit at a time.
  while IFS= read -r id; do
    [ -n "$id" ] && [ "$id" != "$PLUGIN_ID" ] || continue
    run claude plugin uninstall "$id"
  done < <(grep -Eo "\"id\": *\"[^\"]+@$MARKETPLACE\"" <<< "$plugins" | sed -E 's/.*"([^"]+)"$/\1/')

  if grep -Eq "\"id\": *\"$PLUGIN_ID\"" <<< "$plugins"; then
    run claude plugin update "$PLUGIN_ID"
  else
    run claude plugin install "$PLUGIN_ID"
  fi
}

install_agents() {
  say ""
  say "Codex ($AGENTS_SKILLS_DIR, $CODEX_AGENTS_DIR)"
  link_all "$AGENTS_SKILLS_DIR" "$DIST/codex/skills" '*' skills
  # Codex loads custom agents from ~/.codex/agents/<name>.toml.
  link_all "$CODEX_AGENTS_DIR" "$DIST/codex/agents" '*.toml' agents

  # Codex reads ~/.agents/skills too; older installs linked here as well, and
  # a skill in both shows up twice.
  prune_dir legacy "$CODEX_SKILLS_DIR"

  # Hooks are stable and on by default in Codex 0.166, so no config.toml flag
  # is needed. Codex still asks for trust before it runs a new hook.
  sync_hooks codex "$CODEX_HOOKS"
  if [ -z "$KIT" ] && ! $CHECK && ! $DRY_RUN; then
    say "  trust    open Codex and approve the omsg hooks once in /hooks"
  fi
}

# agy scans ~/.gemini/config/skills one level deep and follows symlinks.
install_agy() {
  say ""
  say "Antigravity CLI ($AGY_SKILLS_DIR, $AGY_AGENTS_DIR)"
  link_all "$AGY_SKILLS_DIR" "$DIST/agy/skills" '*' skills
  link_all "$AGY_AGENTS_DIR" "$DIST/agy/agents" '*.md' agents
  sync_hooks agy "$AGY_HOOKS"
}

# omsg_hooks <find|check|apply|remove> <codex|agy> <file>: merges the omsg
# hook entries into a host's hooks file with bun, keeping every other hook.
# Earlier omsg entries are replaced, so a re-run leaves exactly one per event.
# Prints ok|missing|stale (check), present|absent (find), or wrote|current.
OMSG_HOOKS_JS='
const fs = require("fs");
const [mode, host, file] = process.argv.slice(1);
const isOmsg = (c) => /(^|[\s/\\])omsg(\.exe)?\s+hook\s/.test(c || "");
const codexEvents = { SessionStart: "start", PostToolUse: "post-tool", Stop: "stop", SessionEnd: "end" };
const agyEvents = { SessionStart: "start", PreInvocation: "pre-invocation", Stop: "stop" };
let cur = {};
if (fs.existsSync(file)) {
  try { cur = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { console.error("cannot parse " + file); process.exit(2); }
}
const cmd = (ev) => "omsg hook " + ev + " --host " + host;
function strip(root) {
  const out = JSON.parse(JSON.stringify(root));
  if (host === "codex") {
    for (const [ev, groups] of Object.entries(out.hooks || {})) {
      const kept = groups.map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOmsg(h.command)) })).filter((g) => g.hooks.length);
      if (kept.length) out.hooks[ev] = kept; else delete out.hooks[ev];
    }
    if (out.hooks && !Object.keys(out.hooks).length) delete out.hooks;
  } else {
    delete out.omsg;
  }
  return out;
}
function add(root) {
  const out = JSON.parse(JSON.stringify(root));
  if (host === "codex") {
    out.hooks = out.hooks || {};
    for (const [ev, name] of Object.entries(codexEvents)) {
      (out.hooks[ev] = out.hooks[ev] || []).push({ hooks: [{ type: "command", command: cmd(name), timeout: 10 }] });
    }
  } else {
    out.omsg = {};
    for (const [ev, name] of Object.entries(agyEvents)) out.omsg[ev] = [{ type: "command", command: cmd(name), timeout: 10 }];
  }
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stripped = strip(cur);
const has = !same(stripped, cur);
const write = (o) => {
  if (!Object.keys(o).length) { fs.rmSync(file, { force: true }); return; }
  fs.mkdirSync(require("path").dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(o, null, 2) + "\n");
};
if (mode === "find") console.log(has ? "present" : "absent");
else if (mode === "check") console.log(same(add(stripped), cur) ? "ok" : has ? "stale" : "missing");
else if (mode === "apply") { const n = add(stripped); if (same(n, cur)) console.log("current"); else { write(n); console.log("wrote"); } }
else if (mode === "remove") { if (has) { write(stripped); console.log("wrote"); } else console.log("current"); }
'

omsg_hooks() {
  bun -e "$OMSG_HOOKS_JS" "$@"
}

# sync_hooks <codex|agy> <file>: installs the omsg entries in the full kit,
# removes them in a kit; --check reports instead of writing.
sync_hooks() {
  local host="$1" file="$2" state
  if ! has bun; then
    $CHECK && problem no-bun "bun not on PATH; cannot check $host hooks"
    return 0
  fi
  if [ -n "$KIT" ]; then
    state="$(omsg_hooks find "$host" "$file")" || {
      say "  warn     cannot read $file"
      return 0
    }
    [ "$state" = present ] || return 0
    if $CHECK; then
      problem legacy "$file (omsg hooks, not part of kit $KIT)"
      return 0
    fi
    $DRY_RUN || omsg_hooks remove "$host" "$file" > /dev/null
    say "  remove   omsg hooks from $file"
    return 0
  fi
  if $CHECK; then
    state="$(omsg_hooks check "$host" "$file")" || {
      problem unreadable "$file"
      return 0
    }
    if [ "$state" = ok ]; then n_ok=$((n_ok + 1)); else problem "$state" "$file (omsg hooks)"; fi
    return 0
  fi
  if $DRY_RUN; then
    say "  hooks    would merge omsg entries into $file"
    return 0
  fi
  state="$(omsg_hooks apply "$host" "$file")" || {
    say "  warn     cannot merge omsg hooks into $file (unparseable?)"
    return 0
  }
  if [ "$state" = wrote ]; then
    say "  hooks    omsg entries merged into $file"
    n_link=$((n_link + 1))
  else
    n_ok=$((n_ok + 1))
  fi
}

# install_omsg: puts the omsg shim on PATH (the full kit only; a kit removes
# a link of ours). The shim resolves its own real path, so a symlink is enough.
install_omsg() {
  local dst="$BIN_DIR/omsg"
  if [ -n "$KIT" ]; then
    if [ -L "$dst" ] && into_repo "$dst"; then
      if $CHECK; then
        problem legacy "$dst"
        return 0
      fi
      $DRY_RUN || rm -f "$dst"
      say "  prune    $dst (not part of kit $KIT)"
      n_prune=$((n_prune + 1))
    fi
    return 0
  fi
  say ""
  say "omsg ($dst)"
  $DRY_RUN || mkdir -p "$BIN_DIR"
  link_into "$BIN_DIR" "$OMSG_SRC" omsg
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) $CHECK || say "  warn     $BIN_DIR is not on PATH; add it so hooks and agents find omsg" ;;
  esac
}

# Codex walks each skill directory several levels deep, so a node_modules
# inside a skill exposes every SKILL.md that an npm package ships (agent-browser
# ships nine) as an extra, unprefixed skill. bunfig.toml hoists dependencies to
# the root node_modules; this removes per-skill ones left by an older layout.
nested_modules() {
  find "$SKILLS_SRC" "$REPO_ROOT/src/skills" -mindepth 2 -maxdepth 2 -name node_modules -type d 2> /dev/null | sort
}

clean_nested_modules() {
  local dir
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    if $CHECK; then
      problem nested "$dir"
      continue
    fi
    run rm -rf "$dir"
    say "  remove   ${dir#"$REPO_ROOT"/} (bun now hoists to the root)"
  done < <(nested_modules)
}

# The Gemini CLI is not supported. An earlier version linked this clone into
# ~/.gemini/extensions; prune that link if it is still there.
remove_gemini_cli_legacy() {
  prune_dir legacy "$HOME/.gemini/extensions"
}

say "Omnikit Installer"
say "================="
say "Source: $REPO_ROOT"
say "Kit:    ${KIT:-full (everything)}"
if $CHECK; then
  say "Mode:   check, nothing will be written"
elif $DRY_RUN; then
  say "Mode:   dry run, nothing will be written"
fi

if [ ! -d "$REPO_ROOT/src/skills" ]; then
  say "error: $REPO_ROOT/src/skills not found"
  exit 1
fi

if $CHECK; then
  clean_nested_modules
fi

if $DEPS; then
  say ""
  if has bun; then
    say "Installing workspace dependencies (bun install)"
    clean_nested_modules
    if $DRY_RUN; then
      run bun install
    else
      (cd "$REPO_ROOT" && bun install >&2)
    fi
  else
    say "bun not found. Install it from https://bun.sh, then re-run so the"
    say "artistic-vision and agent-browser skills get their dependencies."
  fi
fi

if $IS_WINDOWS && ! $CHECK && ! $DRY_RUN && ! can_symlink; then
  say ""
  windows_symlink_help
  exit 1
fi

build_dist
prune_root_skill_links

# skipped <tool> <binary>: says a target was not chosen because its CLI is
# missing, so a silent install never looks like a successful one.
skipped() {
  $TARGETED && return 0
  say ""
  say "$1: $2 not on PATH, skipped"
}

if $DO_CLAUDE; then install_claude; else skipped "Claude Code" claude; fi
if $DO_AGENTS; then install_agents; else skipped "Codex" codex; fi
if $DO_AGY; then install_agy; else skipped "Antigravity CLI" agy; fi
if $DO_CLAUDE || $DO_AGENTS || $DO_AGY; then install_omsg; fi
remove_gemini_cli_legacy

if $CHECK; then
  say ""
  if [ "$n_problem" -gt 0 ]; then
    say "Found $n_problem problem(s). Fix them with: bash install.sh"
    exit 1
  fi
  say "All links current ($n_ok checked)"
  exit 0
fi

if ! $DO_CLAUDE && ! $DO_AGENTS && ! $DO_AGY; then
  say ""
  say "No supported agent tools found on PATH (claude, codex, agy)."
  say "Install one and re-run, or force a target: bash install.sh --agents"
fi

if $BROWSER; then
  say ""
  say "Running setup-browser-buddy.sh"
  if $DRY_RUN; then
    run bash "$REPO_ROOT/setup-browser-buddy.sh"
  else
    bash "$REPO_ROOT/setup-browser-buddy.sh"
  fi
fi

say ""
say "Linked $n_link, already current $n_ok, pruned $n_prune, conflicts $n_conflict"

if [ "$n_conflict" -gt 0 ]; then
  say ""
  say "Some targets are real files or directories, not symlinks, so they were"
  say "left alone. Move or delete them, or re-run with --force to have this"
  say "script move them aside."
fi

if ! $BROWSER && ! has agent-browser; then
  say ""
  say "The agent-browser skill needs its CLI: bash install.sh --browser"
fi

if $DO_CLAUDE && ! $DRY_RUN; then
  say ""
  say "Claude Code reads the plugin from this clone. Restart open Claude Code,"
  say "Codex, and agy sessions to pick up added or changed skills and agents."
fi
