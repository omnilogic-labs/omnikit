#!/bin/bash
# silence.sh [codex|agy ...]: each host runs 20 tool calls with no mail. Passes
# when the per-tool-call hooks (codex PostToolUse, agy PreInvocation) and Stop
# printed 0 bytes. SessionStart's one-time mail rule is reported apart.
set -e
source "$(dirname "$(realpath "$0")")/lib.sh"
[ $# -gt 0 ] || set -- codex agy
bad=0
for host in "$@"; do
  (
    setup "silence-$host"
    steps=""
    for i in $(seq 1 20); do steps+="$i. \`echo call $i\`"$'\n'; done
    prompt="Run these 20 shell commands in order, one at a time, each as its own separate tool call; never combine them and run nothing else:
$steps
Then answer done."
    run_host "$host" "silence-$host-$$" "$prompt" silence || say "job exited $?"
    calls="$(tool_calls "$host" silence)"
    per_call=0
    for ev in post-tool pre-invocation stop; do
      f="$S/hooks/$host.$ev.out"
      [ -f "$f" ] && per_call=$((per_call + $(wc -c < "$f")))
    done
    start=$(wc -c < "$S/hooks/$host.start.out" 2> /dev/null || echo 0)
    fired=$(grep -cE " hook (post-tool|pre-invocation|stop) --host $host" "$S/hooks/calls.log" || true)
    echo "host=$host tool_calls=$calls hook_calls=$fired hook_output_bytes=$per_call session_start_bytes=$start"
    [ "$calls" -ge 20 ] || fail "$host made only $calls tool calls"
    [ "$per_call" -eq 0 ] || fail "$host hooks printed $per_call bytes with no mail"
    echo "PASS $host"
  ) || bad=1
done
exit $bad
