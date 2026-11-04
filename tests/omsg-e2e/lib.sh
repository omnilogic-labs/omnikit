#!/bin/bash
# Shared helpers for the omsg end-to-end harness. Source it; do not run it.
#
# Every run gets its own scratch dir with:
#   mail/                OMSG_DIR, so the real mailbox is never touched
#   bin/omsg             a link to this checkout's bin/omsg, first on PATH so
#                        the agents' own `omsg send` calls use it too
#   work/                a git repo the agents run in, with project-local hook
#                        files (.codex/hooks.json, .agents/hooks.json) that call
#                        this checkout's bin/omsg by absolute path
#   hooks/<host>.out     every byte each host's omsg hooks printed, and
#   hooks/<host>.<event>.out  the same split by event
#   hooks/calls.log      one line per hook call
# HOME stays real so the hosts stay signed in; no global hook file is touched.
set -e

E2E_DIR="$(dirname "$(realpath "${BASH_SOURCE[0]}")")"
REPO="$(cd "$E2E_DIR/../.." && pwd)"
OMSG_BIN="$REPO/plugins/omnilogic-labs/bin/omsg"

say() { echo "[$(date +%T)] $*" >&2; }
# fail: stop the hosts this run started (their pids are the live/ files in
# its own OMSG_DIR), then exit 1.
fail() {
  say "FAIL: $*"
  local f
  for f in "${OMSG_DIR:-/nonexistent}"/live/*; do
    [ -e "$f" ] && kill "$(basename "$f")" 2> /dev/null
  done
  exit 1
}
nonce() { echo "N$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"; }

# setup <name>: makes the scratch dir and exports S, OMSG_DIR, PATH.
setup() {
  local base="${OMSG_E2E_TMP:-${TMPDIR:-/tmp}}"
  mkdir -p "$base"
  S="$(mktemp -d "$base/omsg-e2e-$1.XXXXXX")"
  export S OMSG_DIR="$S/mail"
  mkdir -p "$S/mail" "$S/bin" "$S/work" "$S/hooks" "$S/runs"
  ln -s "$OMSG_BIN" "$S/bin/omsg"
  export PATH="$S/bin:$PATH"
  unset OMSG_NAME
  # The tap prints what omsg printed and keeps a copy. It execs omsg, so omsg's
  # parent is still the host (codex) or its `sh -c` (agy), as without the tap.
  cat > "$S/hooks/tap.sh" << EOF
#!/bin/bash
echo "\$(date +%T.%N) \$*" >> "$S/hooks/calls.log"
exec > >(tee -a "$S/hooks/\$4.out" "$S/hooks/\$4.\$2.out")
exec "$OMSG_BIN" "\$@"
EOF
  chmod +x "$S/hooks/tap.sh"
  : > "$S/hooks/codex.out"
  : > "$S/hooks/agy.out"
  : > "$S/hooks/calls.log"
  local h="$S/hooks/tap.sh hook"
  mkdir -p "$S/work/.codex" "$S/work/.agents"
  cat > "$S/work/.codex/hooks.json" << EOF
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "$h start --host codex", "timeout": 10 }] }],
    "PostToolUse": [{ "hooks": [{ "type": "command", "command": "$h post-tool --host codex", "timeout": 10 }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "$h stop --host codex", "timeout": 10 }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "$h end --host codex", "timeout": 10 }] }]
  }
}
EOF
  cat > "$S/work/.agents/hooks.json" << EOF
{
  "omsg": {
    "SessionStart": [{ "type": "command", "command": "$h start --host agy", "timeout": 10 }],
    "PreInvocation": [{ "type": "command", "command": "$h pre-invocation --host agy", "timeout": 10 }],
    "Stop": [{ "type": "command", "command": "$h stop --host agy", "timeout": 10 }]
  }
}
EOF
  git -C "$S/work" init -q
  say "scratch dir $S"
}

# run_host <codex|agy|claude> <name> <prompt> <tag>: runs one job in $S/work with stdin
# closed. Writes $S/runs/<tag>.jsonl (the event stream), <tag>.err and
# <tag>.last (the final answer). OMSG_NAME is <name> unless it is "-".
# Run it with & to keep going; the caller waits.
run_host() {
  local host="$1" name="$2" prompt="$3" tag="$4" limit="${OMSG_E2E_TIMEOUT:-600}"
  local -a envs=()
  [ "$name" != - ] && envs=(OMSG_NAME="$name")
  cd "$S/work"
  if [ "$host" = codex ]; then
    env "${envs[@]}" timeout "$limit" codex exec --dangerously-bypass-hook-trust \
      --dangerously-bypass-approvals-and-sandbox --json -o "$S/runs/$tag.last" "$prompt" \
      < /dev/null > "$S/runs/$tag.jsonl" 2> "$S/runs/$tag.err"
  elif [ "$host" = claude ]; then
    # This checkout's plugin, with the installed copy disabled for the run.
    env "${envs[@]}" timeout "$limit" claude -p "$prompt" --plugin-dir "$REPO/plugins/omnilogic-labs" \
      --settings '{"enabledPlugins":{"omnilogic-labs@omnikit":false}}' \
      --permission-mode bypassPermissions --output-format stream-json --verbose \
      < /dev/null > "$S/runs/$tag.jsonl" 2> "$S/runs/$tag.err"
    jq -r 'select(.type == "result") | .result // ""' "$S/runs/$tag.jsonl" > "$S/runs/$tag.last" 2> /dev/null || true
  else
    env "${envs[@]}" timeout "$limit" agy -p "$prompt" --dangerously-skip-permissions \
      --output-format stream-json < /dev/null > "$S/runs/$tag.jsonl" 2> "$S/runs/$tag.err"
    jq -rs '[.[] | select(.event == "result")] | last | .result.response // ""' \
      "$S/runs/$tag.jsonl" > "$S/runs/$tag.last" 2> /dev/null || true
  fi
}

# commands <tag>: every shell command the job ran, one per line.
commands() {
  local f="$S/runs/$1.jsonl"
  jq -r '
    (select(.type == "item.completed" and .item.type == "command_execution") | .item.command),
    (.. | objects | select(has("CommandLine")) | .CommandLine),
    (select(.type == "assistant") | .message.content[]? | select(.type == "tool_use") | .input.command // empty)
  ' "$f" 2> /dev/null | sort -u
}

# tool_calls <host> <tag>: how many tool calls the job made.
tool_calls() {
  local f="$S/runs/$2.jsonl"
  if [ "$1" = codex ]; then
    jq -s '[.[] | select(.type == "item.completed" and .item.type == "command_execution")] | length' "$f"
  else
    jq -s '[.[] | select(.event == "step_update" and .step_update.state == "DONE"
      and .step_update.step_type == "tool")] | length' "$f"
  fi
}

# wait_for <seconds> <command...>: polls every 0.5s until the command succeeds.
wait_for() {
  local secs="$1" i=0
  shift
  while ! "$@" > /dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -ge $((secs * 2)) ] && return 1
    sleep 0.5
  done
}

# who_json: `omsg who --json` as the owner.
who_json() { omsg --as owner --json who; }

# alias_live <alias>: true while a live agent holds the alias.
alias_live() { who_json | jq -e --arg a "$1" 'any(.[]; .alias == $a and .live)' > /dev/null; }

# self_reads <tag>: the job's own commands that read mail (read, count, wait, tail).
self_reads() { commands "$1" | grep -E '(^|[^A-Za-z])omsg( +--[a-z]+( +[^ -][^ ]*)?)* +(read|count|wait|tail)\b' || true; }
