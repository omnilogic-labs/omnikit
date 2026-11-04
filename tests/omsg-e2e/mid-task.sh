#!/bin/bash
# mid-task.sh <codex|agy>: a job runs 15 slow tool calls; after call 5 the
# harness (as the owner) sends it a nonce by its OMSG_NAME. Passes when the
# final answer has the nonce and the job never ran `omsg read` (or count, wait,
# tail) itself, so the hook delivered it.
set -e
source "$(dirname "$(realpath "$0")")/lib.sh"
host="${1:?usage: mid-task.sh <codex|agy>}"
setup "mid-$host"
name="mid-$host-$$"
N="$(nonce)"
steps=""
for i in $(seq 1 15); do steps+="$i. \`sleep 2; echo step $i >> steps.log\`"$'\n'; done
prompt="Run these 15 shell commands in order, one at a time, each as its own separate tool call; never combine them and run nothing else:
$steps
When all 15 are done, your final answer must quote verbatim every message you received while working (if any), then say done."

run_host "$host" "$name" "$prompt" mid &
job=$!
wait_for 240 bash -c "[ \"\$(wc -l < '$S/work/steps.log' 2> /dev/null || echo 0)\" -ge 5 ]" \
  || fail "the job never reached call 5"
after=$(wc -l < "$S/work/steps.log")
omsg send "$name" "Mid-task note from the owner: the code word is $N. Include it in your final answer." >&2
say "sent nonce $N after call $after"
wait "$job" || say "job exited $?"

final="$(cat "$S/runs/mid.last" 2> /dev/null || true)"
calls="$(tool_calls "$host" mid)"
reads="$(self_reads mid)"
echo "host=$host calls=$calls sent_after_call=$after nonce=$N"
echo "final answer: $(tr '\n' ' ' <<< "$final" | cut -c1-400)"
echo "self-run mail reads: ${reads:-none}"
echo "hook output bytes: $(wc -c < "$S/hooks/$host.out")"
grep -F "$N" "$S/hooks/$host.out" | sed 's/^/delivered by hook: /' | cut -c1-300
echo "transcript: $S/runs/mid.jsonl"
grep -qF "$N" <<< "$final" || fail "the final answer lacks the nonce $N"
[ -z "$reads" ] || fail "the job read its mail itself"
grep -qF "$N" "$S/hooks/$host.out" || fail "no hook printed the nonce"
echo PASS
