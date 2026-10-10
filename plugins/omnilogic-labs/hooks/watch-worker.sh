#!/bin/bash
# Watches one external worker job for the external-runner agent, so the job's
# progress shows in that agent's transcript.
#
# Usage: watch-worker.sh <job dir> [max seconds]
#
# Each call watches for at most max seconds (default WATCH_MAX, else 60), so the
# agent gets a result, and writes a line to its transcript, about once a minute.
# It reports only the stream events added since the previous call: the read
# position is kept in <job dir>/watch.seen. It ends with one of:
#   DONE exit <code>   the job's exit file appeared; the final message follows
#   RUNNING ...        max seconds passed first; run this again to keep watching
#   STALE ...          no exit file well past the job's timeout
# It exits 0 in every case but a bad job dir; the job's own code is on the
# DONE line.
set -e

dir=$1
max=${2:-${WATCH_MAX:-60}}
if [ -z "$dir" ] || [ ! -f "$dir/params" ]; then
  echo "watch-worker: usage: watch-worker.sh <job dir> [max seconds]" >&2
  exit 2
fi

{
  IFS= read -r engine || true
  IFS= read -r _cwd || true
  IFS= read -r timeout_sec || true
} < "$dir/params"
timeout_sec=${timeout_sec:-1800}
started=$(stat -c %Y "$dir/params" 2> /dev/null || stat -f %m "$dir/params")
has_jq=0
command -v jq > /dev/null 2>&1 && has_jq=1

cut_line() { tr -s '[:space:]' ' ' | cut -c 1-"${1:-160}"; }

mmss() { printf '%02d:%02d' $(($1 / 60)) $(($1 % 60)); }

# Prints what the stream lines after the saved position say, then saves the
# new position.
seen=$(cat "$dir/watch.seen" 2> /dev/null || echo 0)
[[ $seen =~ ^[0-9]+$ ]] || seen=0
report() {
  local stream="$dir/stream.jsonl" total new elapsed
  total=$( (wc -l < "$stream") 2> /dev/null | tr -d ' ' || echo 0)
  total=${total:-0}
  elapsed=$(mmss $(($(date +%s) - started)))
  if [ "$total" -le "$seen" ]; then
    echo "[$elapsed] $engine: $total events, no new output"
    return
  fi
  new=$(tail -n +"$((seen + 1))" "$stream" | head -n "$((total - seen))")
  echo "[$elapsed] $engine: $((total - seen)) new events ($total total)"
  seen=$total
  echo "$seen" > "$dir/watch.seen"
  if [ "$has_jq" -eq 0 ]; then
    printf '%s\n' "$new" | tail -n 3 | while IFS= read -r l; do printf '  %s\n' "$(printf '%s' "$l" | cut_line)"; done
    return
  fi
  case "$engine" in
    agy)
      # Tool steps as one line each; the reply's text_delta pieces joined.
      printf '%s\n' "$new" \
        | jq -Rr 'fromjson? | .step_update // empty | select(.step_type == "tool" and .state == "ACTIVE")
            | "\(.tool_name): \(.tool_info.parameters // {} | tostring)" | gsub("\\s+"; " ")' 2> /dev/null \
        | tail -n 8 | while IFS= read -r l; do printf '  %s\n' "$(printf '%s' "$l" | cut_line)"; done
      local text
      text=$(printf '%s\n' "$new" \
        | jq -Rrj 'fromjson? | .step_update // empty | select(.step_type == "agent_response") | .text_delta // empty' \
          2> /dev/null | tr -s '[:space:]' ' ' | tail -c 300)
      [ -n "$text" ] && printf '  said: %s\n' "$text"
      ;;
    codex)
      printf '%s\n' "$new" \
        | jq -Rr 'fromjson? | .item as $i | select($i != null)
            | if .type == "item.completed" and $i.type == "agent_message" then "said: \($i.text)"
              elif .type == "item.started" and $i.type == "command_execution" then "ran: \($i.command)"
              elif .type == "item.completed" and $i.type == "file_change" then "edited: \([$i.changes[]?.path] | join(", "))"
              elif .type == "item.completed" and ($i.type | test("command_execution|agent_message|reasoning") | not)
                then "\($i.type): \($i.text // "")"
              else empty end | gsub("\\s+"; " ")' 2> /dev/null \
        | tail -n 8 | while IFS= read -r l; do printf '  %s\n' "$(printf '%s' "$l" | cut_line 200)"; done
      ;;
    *)
      printf '%s\n' "$new" | tail -n 3 | while IFS= read -r l; do printf '  %s\n' "$(printf '%s' "$l" | cut_line)"; done
      ;;
  esac
}

begin=$SECONDS
while true; do
  if [ -f "$dir/exit" ]; then
    report
    echo "DONE exit $(tr -d '[:space:]' < "$dir/exit")"
    echo "--- final message ---"
    cat "$dir/last.txt" 2> /dev/null || echo "(no last.txt)"
    exit 0
  fi
  if [ $(($(date +%s) - started)) -gt $((timeout_sec + 120)) ]; then
    report
    echo "STALE: no exit file $((timeout_sec + 120))s after the job started; stderr tail:"
    tail -n 20 "$dir/stderr.log" 2> /dev/null || true
    exit 0
  fi
  if [ $((SECONDS - begin)) -ge "$max" ]; then
    report
    echo "RUNNING: write one line on what the worker is doing, then run this command again"
    exit 0
  fi
  sleep 1
done
