#!/bin/bash
# Install every skill, agent, and command in this repo into the agent tools on
# this machine. Everything is installed as a symlink back into this clone, so
# editing a file here changes the live version immediately: no re-install step,
# and no copies that drift from the source.
#
# Safe to re-run. Status goes to stderr.
set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
CODEX_SKILLS_DIR="${CODEX_HOME:-$HOME/.codex}/skills"

DO_CLAUDE=false
DO_CODEX=false
DO_GEMINI=false
TARGETED=false
DEPS=true
BROWSER=false
DRY_RUN=false
FORCE=false

n_link=0
n_ok=0
n_prune=0
n_conflict=0

usage() {
  cat >&2 << 'USAGE'
Usage: bash install.sh [options]

Links this repo's skills, agents, and commands into the agent tools on this
machine. Edits to files in the repo take effect immediately.

Targets (default: every tool found on PATH):
  --claude          Claude Code only (skills, agents, commands)
  --codex           Codex CLI only (skills)
  --gemini          Gemini CLI only (extension)

Options:
  --no-deps         skip "bun install"
  --browser         also run setup-browser-buddy.sh (downloads Chrome)
  --force           move aside a real file or directory blocking a link
  -n, --dry-run     report what would change, change nothing
  -h, --help        this message
USAGE
}

say() { echo "$*" >&2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --claude) DO_CLAUDE=true && TARGETED=true ;;
    --codex) DO_CODEX=true && TARGETED=true ;;
    --gemini) DO_GEMINI=true && TARGETED=true ;;
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

if ! $TARGETED; then
  command -v claude > /dev/null 2>&1 && DO_CLAUDE=true
  command -v codex > /dev/null 2>&1 && DO_CODEX=true
  command -v gemini > /dev/null 2>&1 && DO_GEMINI=true
fi

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
      say "  ok       $name"
      n_ok=$((n_ok + 1))
      return 0
    fi
    case "$(cd "$dir" && readlink -m "$name")" in
      "$REPO_ROOT"/*) ;;
      *) say "  replace  $name (was -> $current)" ;;
    esac
  elif [ -e "$dst" ]; then
    if $FORCE; then
      backup="$dst.replaced-$(date +%Y%m%d%H%M%S)"
      $DRY_RUN || mv "$dst" "$backup"
      say "  backup   $name -> $(basename "$backup")"
    else
      say "  CONFLICT $name: $dst exists and is not a symlink. Re-run with --force to move it aside."
      n_conflict=$((n_conflict + 1))
      return 0
    fi
  fi

  $DRY_RUN || ln -sfn "$src" "$dst"
  say "  link     $name"
  n_link=$((n_link + 1))
}

# prune_dir <target-dir> <name>...
#
# Removes symlinks in <target-dir> that point into this repo but are not in the
# list of names we just installed: skills that were renamed, deleted, or moved
# to another plugin. Links pointing anywhere else are left alone.
prune_dir() {
  local dir="$1"
  shift
  local keep=" $* " entry name resolved

  [ -d "$dir" ] || return 0

  for entry in "$dir"/*; do
    [ -L "$entry" ] || continue
    name="$(basename "$entry")"
    case "$keep" in *" $name "*) continue ;; esac
    resolved="$(cd "$dir" && readlink -m "$name")"
    case "$resolved" in "$REPO_ROOT"/*) ;; *) continue ;; esac
    $DRY_RUN || rm -f "$entry"
    say "  prune    $name (stale link into the repo)"
    n_prune=$((n_prune + 1))
  done
}

# Reads the "name:" field from a markdown file's YAML frontmatter. Agents are
# registered under that name, not their filename, so the symlink uses it too:
# a generic delegate.md in a shared agents directory collides with everything.
frontmatter_name() {
  local value
  value="$(awk '
    NR == 1 && $0 != "---" { exit }
    NR > 1 {
      if ($0 == "---") exit
      if ($1 == "name:") { print $2; exit }
    }
  ' "$1")"
  if [ -n "$value" ]; then
    echo "$value"
  else
    basename "$1" .md
  fi
}

skill_dirs() { find "$REPO_ROOT/plugins" -mindepth 3 -maxdepth 3 -type d -path '*/skills/*' | sort; }
agent_files() { find "$REPO_ROOT/plugins" -mindepth 3 -maxdepth 3 -type f -path '*/agents/*.md' | sort; }
command_files() { find "$REPO_ROOT/plugins" -mindepth 3 -maxdepth 3 -type f -path '*/commands/*.md' | sort; }

# The flat skills/ directory at the repo root is how Codex, Gemini, and the
# `npx skills` installer discover skills whose canonical home is plugins/*.
# It is generated, not hand-maintained, so a new plugin never gets forgotten.
sync_repo_skills() {
  local dir="$REPO_ROOT/skills" names=() src name
  say ""
  say "Repo skills/ index"
  $DRY_RUN || mkdir -p "$dir"

  while IFS= read -r src; do
    name="$(basename "$src")"
    names+=("$name")
    link_into "$dir" "../${src#"$REPO_ROOT"/}" "$name"
  done < <(skill_dirs)

  prune_dir "$dir" "${names[@]}"
}

install_claude() {
  local names=() src name
  say ""
  say "Claude Code ($CLAUDE_DIR)"

  $DRY_RUN || mkdir -p "$CLAUDE_DIR/skills" "$CLAUDE_DIR/agents" "$CLAUDE_DIR/commands"

  say " skills"
  names=()
  while IFS= read -r src; do
    name="$(basename "$src")"
    names+=("$name")
    link_into "$CLAUDE_DIR/skills" "$src" "$name"
  done < <(skill_dirs)
  prune_dir "$CLAUDE_DIR/skills" "${names[@]}"

  say " agents"
  names=()
  while IFS= read -r src; do
    name="$(frontmatter_name "$src").md"
    names+=("$name")
    link_into "$CLAUDE_DIR/agents" "$src" "$name"
  done < <(agent_files)
  prune_dir "$CLAUDE_DIR/agents" "${names[@]}"

  say " commands"
  names=()
  while IFS= read -r src; do
    name="$(basename "$src")"
    names+=("$name")
    link_into "$CLAUDE_DIR/commands" "$src" "$name"
  done < <(command_files)
  prune_dir "$CLAUDE_DIR/commands" "${names[@]}"
}

install_codex() {
  local names=() src name
  say ""
  say "Codex CLI ($CODEX_SKILLS_DIR)"
  $DRY_RUN || mkdir -p "$CODEX_SKILLS_DIR"

  while IFS= read -r src; do
    name="$(basename "$src")"
    names+=("$name")
    link_into "$CODEX_SKILLS_DIR" "$src" "$name"
  done < <(skill_dirs)

  prune_dir "$CODEX_SKILLS_DIR" "${names[@]}"
}

install_gemini() {
  say ""
  say "Gemini CLI"

  if ! command -v gemini > /dev/null 2>&1; then
    say "  gemini not on PATH. Install it, then run: bash install.sh --gemini"
    return 0
  fi

  if $DRY_RUN; then
    say "  would run: gemini extensions link ."
    return 0
  fi

  if (cd "$REPO_ROOT" && gemini extensions link .) >&2; then
    say "  linked this clone as an extension; edits are live"
  else
    say "  extension link failed, falling back to per-skill links" >&2
    local src
    while IFS= read -r src; do
      gemini skills link "$src" >&2 || say "  skip $(basename "$src")"
    done < <(skill_dirs)
  fi
}

say "Omnikit Installer"
say "================="
say "Source: $REPO_ROOT"
$DRY_RUN && say "Mode:   dry run, nothing will be written"

if $DEPS; then
  if command -v bun > /dev/null 2>&1; then
    say ""
    say "Installing workspace dependencies (bun install)"
    $DRY_RUN || (cd "$REPO_ROOT" && bun install >&2)
  else
    say ""
    say "bun not found. Install it from https://bun.sh, then re-run so the"
    say "artistic-vision and browser-buddy skills get their dependencies."
  fi
fi

sync_repo_skills

$DO_CLAUDE && install_claude
$DO_CODEX && install_codex
$DO_GEMINI && install_gemini

if ! $DO_CLAUDE && ! $DO_CODEX && ! $DO_GEMINI; then
  say ""
  say "No supported agent tools found on PATH (claude, codex, gemini)."
  say "Install one and re-run, or force a target: bash install.sh --claude"
fi

if $BROWSER; then
  say ""
  say "Running setup-browser-buddy.sh"
  $DRY_RUN || bash "$REPO_ROOT/setup-browser-buddy.sh"
fi

say ""
say "Linked $n_link, already current $n_ok, pruned $n_prune, conflicts $n_conflict"

if [ "$n_conflict" -gt 0 ]; then
  say ""
  say "Some targets are real files or directories, not symlinks, so they were"
  say "left alone. Move or delete them, or re-run with --force to have this"
  say "script move them aside."
fi

if ! $BROWSER && ! command -v agent-browser > /dev/null 2>&1; then
  say ""
  say "The agent-browser skill needs its CLI: bash install.sh --browser"
fi

say ""
say "Everything above is a symlink into $REPO_ROOT."
say "Edit a skill there and the change is live. Restart running sessions to"
say "pick up new or renamed skills, agents, and commands."
