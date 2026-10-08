#!/bin/bash
# Verify that Claude Code, Codex, and agy see the omnilogic-labs skills.
#
#   bash scripts/verify-install.sh          deterministic checks only
#   bash scripts/verify-install.sh --ask    also ask each tool's model
#
# Deterministic checks: install.sh --check, the Claude Code marketplace and
# plugin list, the skills, agents, plugin, and external_worker tool in Claude
# Code's system/init event, and the skill links Codex and agy read.
#
# --ask runs one prompt per tool (claude, codex, agy) and checks that each
# answer names every skill. It costs a few model calls and up to a few minutes.
#
# Status goes to stderr. stdout gets one TSV line per check
# (pass|fail|skip, check name, detail) and a final "summary" line.
# Exits 0 only when no check fails.
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
PLUGIN_DIR="$REPO_ROOT/plugins/omnilogic-labs"
NS="omnilogic-labs"
PLUGIN_ID="$NS@omnikit"
WORKER_TOOL="mcp__${NS}__external_worker"
AGENTS_SKILLS_DIR="$HOME/.agents/skills"
CODEX_SKILLS_DIR="${CODEX_HOME:-$HOME/.codex}/skills"
AGY_SKILLS_DIR="$HOME/.gemini/config/skills"
ASK_TIMEOUT=300

ASK=false
n_pass=0
n_fail=0
n_skip=0

usage() {
  sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//' >&2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --ask) ASK=true ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

say() { echo "$*" >&2; }
has() { command -v "$1" > /dev/null 2>&1; }

if ! has jq; then
  say "error: jq not found. Install it (Windows: winget install jqlang.jq, then open a new shell)."
  exit 1
fi

# result <pass|fail|skip> <check> <detail>
result() {
  printf '%s\t%s\t%s\n' "$1" "$2" "$3"
  case "$1" in
    pass) n_pass=$((n_pass + 1)) ;;
    fail) n_fail=$((n_fail + 1)) ;;
    skip) n_skip=$((n_skip + 1)) ;;
  esac
  # When stdout is the terminal too, the TSV line already shows there.
  [ -t 1 ] || say "  $1  $2: $3"
}

# The main checkout, even when this runs from a git worktree. The installed
# marketplace should point here.
MAIN_ROOT="$REPO_ROOT"
common="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2> /dev/null || true)"
if [ -n "$common" ]; then
  MAIN_ROOT="$(cd "$common/.." && pwd -P)"
fi

mapfile -t SKILLS < <(find "$PLUGIN_DIR/skills" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
mapfile -t AGENTS < <(find "$PLUGIN_DIR/agents" -mindepth 1 -maxdepth 1 -name '*.md' -printf '%f\n' | sed 's/\.md$//' | sort)

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

# missing_from <file> <prefix> <name...>: prints each <prefix><name> that does
# not appear in <file>, comma separated.
missing_from() {
  local file="$1" prefix="$2" name out=()
  shift 2
  for name in "$@"; do
    grep -qF -- "$prefix$name" "$file" || out+=("$prefix$name")
  done
  local IFS=,
  echo "${out[*]}"
}

# json_list <prefix> <name...>: a JSON array of <prefix><name> strings.
json_list() {
  local prefix="$1"
  shift
  printf '%s\n' "$@" | sed "s/^/$prefix/" | jq -R . | jq -sc .
}

check_install() {
  say ""
  say "install.sh --check"
  if bash "$REPO_ROOT/install.sh" --check > "$SCRATCH/check.tsv" 2> /dev/null; then
    result pass install-check "no missing, stale, legacy, or nested entries"
  else
    result fail install-check "$(tr '\t\n' ' ;' < "$SCRATCH/check.tsv")"
  fi
}

check_claude() {
  say ""
  say "Claude Code"
  if ! has claude; then
    result skip claude "claude not on PATH"
    return 0
  fi

  local path stale init
  path="$(claude plugin marketplace list --json 2> /dev/null | jq -r '.[] | select(.name == "omnikit") | .path // .installLocation // empty')"
  # On Windows claude prints D:\x\y; compare it in this shell's /d/x/y form.
  if [ -n "$path" ] && has cygpath; then path="$(cygpath -u "$path")"; fi
  if [ "$path" = "$MAIN_ROOT" ]; then
    result pass claude-marketplace "omnikit -> $path"
  else
    result fail claude-marketplace "omnikit points at '${path:-nothing}', expected $MAIN_ROOT"
  fi

  claude plugin list --json 2> /dev/null > "$SCRATCH/plugins.json" || echo '[]' > "$SCRATCH/plugins.json"
  if jq -e --arg id "$PLUGIN_ID" 'any(.[]; .id == $id and .enabled == true)' "$SCRATCH/plugins.json" > /dev/null; then
    result pass claude-plugin "$PLUGIN_ID enabled"
  else
    result fail claude-plugin "$PLUGIN_ID not installed or not enabled"
  fi
  stale="$(jq -r --arg id "$PLUGIN_ID" '[.[] | select((.id | endswith("@omnikit")) and .id != $id) | .id] | join(",")' "$SCRATCH/plugins.json")"
  if [ -z "$stale" ]; then
    result pass claude-stale-plugins "none"
  else
    result fail claude-stale-plugins "$stale"
  fi

  # The system/init event lists what the session actually loaded. It comes
  # before the model answers, so the prompt only needs to be trivial.
  (cd "$REPO_ROOT" && timeout "$ASK_TIMEOUT" claude -p "Reply with the single word OK." \
    --output-format stream-json --verbose --no-session-persistence < /dev/null 2> /dev/null) \
    > "$SCRATCH/claude.jsonl" || true
  init="$SCRATCH/init.json"
  jq -c 'select(.type == "system" and .subtype == "init")' "$SCRATCH/claude.jsonl" 2> /dev/null | head -1 > "$init" || true
  if [ ! -s "$init" ]; then
    result fail claude-init "no system/init event from claude -p"
    return 0
  fi

  local want_skills want_agents
  want_skills="$(json_list "$NS:" "${SKILLS[@]}")"
  want_agents="$(json_list "$NS:" "${AGENTS[@]}")"

  local missing dups extra
  missing="$(jq -r --argjson w "$want_skills" '$w - .skills | join(",")' "$init")"
  extra="$(jq -r --arg ns "$NS:" '[.skills[] | select(startswith($ns))] | length' "$init")"
  if [ -z "$missing" ]; then
    result pass claude-skills "$extra $NS: skills"
  else
    result fail claude-skills "missing $missing"
  fi

  missing="$(jq -r --argjson w "$want_agents" '$w - .agents | join(",")' "$init")"
  extra="$(jq -r --arg ns "$NS:" '[.agents[] | select(startswith($ns))] | length' "$init")"
  if [ -z "$missing" ]; then
    result pass claude-agents "$extra $NS: agents"
  else
    result fail claude-agents "missing $missing"
  fi

  # An unprefixed copy means a legacy link in ~/.claude is still loading.
  dups="$(jq -r --argjson s "$(json_list "" "${SKILLS[@]}" "${AGENTS[@]}")" \
    '[(.skills + .agents)[] | select(. as $n | any($s[]; . == $n))] | unique | join(",")' "$init")"
  if [ -z "$dups" ]; then
    result pass claude-duplicates "no unprefixed copies"
  else
    result fail claude-duplicates "unprefixed: $dups"
  fi

  if jq -e --arg id "$PLUGIN_ID" 'any(.plugins[]; .source == $id)' "$init" > /dev/null; then
    result pass claude-init-plugin "$(jq -r --arg id "$PLUGIN_ID" '.plugins[] | select(.source == $id) | .path' "$init")"
  else
    result fail claude-init-plugin "$PLUGIN_ID not loaded"
  fi

  if jq -e --arg t "$WORKER_TOOL" 'any(.tools[]; . == $t)' "$init" > /dev/null; then
    result pass claude-worker-tool "$WORKER_TOOL"
  else
    result fail claude-worker-tool "$WORKER_TOOL missing"
  fi
}

# check_links <check> <dir>: <dir> holds exactly one link per skill, each into
# this plugin, and no SKILL.md below a skill's top level.
check_links() {
  local check="$1" dir="$2" name bad=() nested
  for name in "${SKILLS[@]}"; do
    [ "$(readlink -f "$dir/$name" 2> /dev/null)" = "$(readlink -f "$PLUGIN_DIR/skills/$name")" ] || bad+=("$name")
  done
  if [ "${#bad[@]}" -eq 0 ]; then
    result pass "$check" "${#SKILLS[@]} links in $dir"
  else
    result fail "$check" "missing or wrong in $dir: ${bad[*]}"
  fi

  nested="$(for name in "${SKILLS[@]}"; do
    find -L "$dir/$name" -mindepth 2 -name SKILL.md 2> /dev/null
  done | wc -l)"
  if [ "$nested" -eq 0 ]; then
    result pass "$check-nested" "no nested SKILL.md files"
  else
    result fail "$check-nested" "$nested nested SKILL.md files (run: bash install.sh)"
  fi
}

check_codex_agy() {
  local entry n=0
  say ""
  say "Codex and agy skill links"
  check_links codex-links "$AGENTS_SKILLS_DIR"

  for entry in "$CODEX_SKILLS_DIR"/*; do
    [ -L "$entry" ] || continue
    case "$(readlink -m "$entry")" in "$MAIN_ROOT"/* | "$REPO_ROOT"/*) n=$((n + 1)) ;; esac
  done
  if [ "$n" -eq 0 ]; then
    result pass codex-legacy-links "none in $CODEX_SKILLS_DIR"
  else
    result fail codex-legacy-links "$n in $CODEX_SKILLS_DIR"
  fi

  if has agy || [ -d "$AGY_SKILLS_DIR" ]; then
    check_links agy-links "$AGY_SKILLS_DIR"
  else
    result skip agy-links "agy not on PATH"
  fi
}

QUESTION="List every skill you have discovered (and every subagent type, if you have any) whose name contains $NS or matches one of these: ${SKILLS[*]}. One per line, exactly as you see it. Then say whether any of them appears twice, with and without a prefix. Do not use tools."

# ask <check> <binary> <cmd...>: runs one model query from the repo root and
# checks that the answer names every skill.
ask() {
  local check="$1" bin="$2" out missing
  shift 2
  if ! has "$bin"; then
    result skip "$check" "$bin not on PATH"
    return 0
  fi
  out="$SCRATCH/$check.txt"
  say "  asking $bin (up to ${ASK_TIMEOUT}s)"
  if ! (cd "$REPO_ROOT" && timeout "$ASK_TIMEOUT" "$@" < /dev/null > "$out" 2> "$out.err"); then
    result fail "$check" "$bin exited non-zero: $(tail -1 "$out.err")"
    return 0
  fi
  # claude --output-format json wraps the answer; show the text itself.
  if [ "$bin" = claude ]; then
    jq -r '.result // empty' "$out" > "$out.text" 2> /dev/null || cp "$out" "$out.text"
    mv "$out.text" "$out"
  fi
  sed 's/^/    | /' "$out" >&2
  missing="$(missing_from "$out" "" "${SKILLS[@]}")"
  if [ -z "$missing" ]; then
    result pass "$check" "all ${#SKILLS[@]} skills named"
  else
    result fail "$check" "answer lacks $missing"
  fi
}

check_ask() {
  say ""
  say "Model queries"
  ask ask-claude claude claude -p "$QUESTION" --output-format json --no-session-persistence
  ask ask-codex codex codex exec -s read-only "$QUESTION"
  ask ask-agy agy agy -p "$QUESTION" --mode plan --sandbox
}

say "Omnikit install verification"
say "Repo: $REPO_ROOT"
say "Expect ${#SKILLS[@]} skills (${SKILLS[*]}) and ${#AGENTS[@]} agents (${AGENTS[*]})"

check_install
check_claude
check_codex_agy
$ASK && check_ask

printf 'summary\tpass=%d\tfail=%d\tskip=%d\n' "$n_pass" "$n_fail" "$n_skip"
say ""
if [ "$n_fail" -gt 0 ]; then
  say "FAILED: $n_fail check(s)"
  exit 1
fi
say "OK: $n_pass passed, $n_skip skipped"
