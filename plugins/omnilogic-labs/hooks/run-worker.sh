#!/bin/bash
# Runs one external worker job for the external_worker tool (hooks/register.tsx).
#
# Usage: run-worker.sh <job dir>
#
# The job dir holds what the hook wrote before calling this:
#   task.txt   the task, verbatim
#   params     one value per line: engine, cwd, timeoutSec, model, effort,
#              sandbox (none, workspace-write or read-only)
# and what this script writes:
#   stream.jsonl  the engine's JSONL events (stdout only)
#   stderr.log    the engine's stderr, kept apart so stream.jsonl stays valid
#   last.txt      the final answer
#   exit          the exit code, written last (the hook polls for it)
# It ends by printing last.txt, so the background task's notification carries
# the final answer.
#
# agy stream-json shape (agy 1.3.1), one object per line keyed by "event":
#   {"event":"init","conversation_id":...,"init":{"cwd":...,"tools":[...]}}
#   {"event":"step_update","step_update":{"step_index":1,"state":"ACTIVE",
#     "step_type":"agent_response","text_delta":"..."}}
#   {"event":"result","result":{"status":"SUCCESS","response":"<final>",...}}
# The final answer is .result.response of the last "result" event.
set -e

if [ "$1" = "--fake" ]; then
  # Harmless stand-in engine: JSONL lines a second apart, then a final message.
  # Three lines, or N for a task that starts with "steps=N" (to test long jobs).
  # Runs as its own process so coreutils timeout can wrap it.
  task=$(cat "$2/task.txt")
  steps=3
  if [[ $task =~ ^steps=([0-9]+) ]]; then steps=${BASH_REMATCH[1]}; fi
  for ((i = 1; i <= steps; i++)); do
    printf '{"type":"item","n":%d,"text":"step %d"}\n' "$i" "$i"
    sleep 1
  done
  printf 'fake worker finished: %s\n' "$task" > "$2/last.txt"
  exit 0
fi

dir=$1
if [ -z "$dir" ] || [ ! -f "$dir/task.txt" ] || [ ! -f "$dir/params" ]; then
  echo "run-worker: usage: run-worker.sh <job dir with task.txt and params>" >&2
  exit 2
fi

{
  IFS= read -r engine || true
  IFS= read -r cwd || true
  IFS= read -r timeout_sec || true
  IFS= read -r model || true
  IFS= read -r effort || true
  IFS= read -r sandbox || true
} < "$dir/params"
timeout_sec=${timeout_sec:-1800}
sandbox=${sandbox:-none}

finish() {
  local rc=$1
  if [ ! -s "$dir/last.txt" ]; then
    {
      echo "(no final message; exit $rc)"
      if [ -s "$dir/stderr.log" ]; then
        echo "stderr tail:"
        tail -n 20 "$dir/stderr.log"
      fi
    } > "$dir/last.txt"
  fi
  echo "$rc" > "$dir/exit.tmp"
  mv "$dir/exit.tmp" "$dir/exit"
  echo "[run-worker] $engine job in $dir exited $rc" >&2
  cat "$dir/last.txt"
  exit "$rc"
}

: > "$dir/stream.jsonl"
: > "$dir/stderr.log"

if ! cd "$cwd" 2> /dev/null; then
  echo "run-worker: cwd does not exist or is not a directory: $cwd" >> "$dir/stderr.log"
  finish 2
fi

task=$(cat "$dir/task.txt")
rc=0
case "$engine" in
  codex)
    args=(exec --json -C "$cwd" -o "$dir/last.txt")
    case "$sandbox" in
      none) args+=(--dangerously-bypass-approvals-and-sandbox) ;;
      *) args+=(-s "$sandbox") ;;
    esac
    [ -n "$model" ] && args+=(-m "$model")
    [ -n "$effort" ] && args+=(-c "model_reasoning_effort=\"$effort\"")
    timeout "$timeout_sec" codex "${args[@]}" "$task" \
      < /dev/null > "$dir/stream.jsonl" 2> "$dir/stderr.log" || rc=$?
    ;;
  agy)
    args=(-p "$task" --output-format stream-json)
    case "$sandbox" in
      none) args+=(--mode accept-edits --dangerously-skip-permissions) ;;
      workspace-write) args+=(--mode accept-edits --sandbox) ;;
      read-only) args+=(--mode plan --sandbox) ;;
    esac
    [ -n "$model" ] && args+=(--model "$model")
    [ -n "$effort" ] && args+=(--effort "$effort")
    timeout "$timeout_sec" agy "${args[@]}" \
      < /dev/null > "$dir/stream.jsonl" 2> "$dir/stderr.log" || rc=$?
    if command -v jq > /dev/null 2>&1; then
      jq -rs '[.[] | select(.event == "result")] | last | .result.response // empty' \
        "$dir/stream.jsonl" > "$dir/last.txt" 2>> "$dir/stderr.log" || true
      status=$(jq -rs '[.[] | select(.event == "result")] | last | .result.status // empty' \
        "$dir/stream.jsonl" 2> /dev/null || true)
      if [ "$rc" -eq 0 ] && [ -n "$status" ] && [ "$status" != "SUCCESS" ]; then
        echo "run-worker: agy result status $status" >> "$dir/stderr.log"
        rc=1
      fi
    else
      # No jq: keep the raw last result line rather than guess at its escaping.
      grep '"event":"result"' "$dir/stream.jsonl" | tail -n 1 > "$dir/last.txt" || true
    fi
    ;;
  fake)
    timeout "$timeout_sec" bash "$0" --fake "$dir" \
      < /dev/null > "$dir/stream.jsonl" 2> "$dir/stderr.log" || rc=$?
    ;;
  *)
    echo "run-worker: unknown engine: $engine" >> "$dir/stderr.log"
    rc=2
    ;;
esac

finish "$rc"
