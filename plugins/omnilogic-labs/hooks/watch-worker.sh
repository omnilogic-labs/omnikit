#!/bin/bash
# Watches one external worker job for the external-runner agent, so the job's
# progress shows in that agent's transcript.
#
# Usage: watch-worker.sh <job dir> [max seconds]
#
# Prints a progress line every WATCH_INTERVAL seconds (default 20) while the
# job runs, then ends with one of:
#   DONE exit <code>   the job's exit file appeared; the final message follows
#   RUNNING ...        max seconds (default 540, under Bash's 10 minute cap)
#                      passed first; run this again to keep watching
#   STALE ...          no exit file well past the job's timeout
# It exits 0 in every case but a bad job dir; the job's own code is on the
# DONE line.
set -e

dir=$1
max=${2:-540}
interval=${WATCH_INTERVAL:-20}
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

# Prints what the stream lines after line $seen say, then advances $seen.
seen=0
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
  seen=$total
  echo "[$elapsed] $engine: $total events"
  if [ "$has_jq" -eq 0 ]; then
    printf '%s\n' "$new" | tail -n 1 | cut_line | sed 's/^/  /'
    return
  fi
  case "$engine" in
    agy)
      # step_update events carry the reply in small text_delta pieces: join them.
      printf '%s\n' "$new" \
        | jq -Rrj 'fromjson? | select(.event == "step_update") | .step_update.text_delta // empty' \
          2> /dev/null | tr -s '[:space:]' ' ' | tail -c 200 | sed 's/^/  /'
      echo
      ;;
    codex)
      printf '%s\n' "$new" \
        | jq -Rr 'fromjson? | select(.type == "item.completed")
            | "\(.item.type): \(.item.text // .item.command // "")"' 2> /dev/null \
        | tail -n 5 | while IFS= read -r l; do printf '  %s\n' "$(printf '%s' "$l" | cut_line)"; done
      ;;
    *)
      printf '%s\n' "$new" | tail -n 1 | cut_line | sed 's/^/  /'
      ;;
  esac
}

begin=$SECONDS
last=$SECONDS
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
    echo "RUNNING after $(mmss $((SECONDS - begin))) of watching; run this command again to keep watching"
    exit 0
  fi
  if [ $((SECONDS - last)) -ge "$interval" ]; then
    report
    last=$SECONDS
  fi
  sleep 1
done
