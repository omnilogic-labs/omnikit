#!/bin/bash
# relay.sh: codex -> agy -> Claude. A `claude -p` session (this checkout's
# plugin, installed copy disabled) and an agy worker named by OMSG_NAME run
# slow tool calls; a codex job mails the agy worker a relay request carrying
# nonce K; agy, getting it from its hook, sends K on to the Claude session; the
# Claude mod delivers it. Passes when each leg's record is in the mail logs,
# Claude's final answer has K, and no job ran `omsg read` (count, wait, tail).
set -e
source "$(dirname "$(realpath "$0")")/lib.sh"
setup relay
K="$(nonce)"
agy_name="relay-agy-$$"

slow() {
  local n="$1" tag="$2" steps=""
  for i in $(seq 1 "$n"); do steps+="$i. \`sleep 3; echo $tag $i\`"$'\n'; done
  printf %s "$steps"
}

run_host claude - "Please run these 30 shell commands in order, one at a time, each as its own separate Bash tool call, without combining them:
$(slow 30 claude)
After the last one, tell me what any message that reached you during the work said, including any code word, then say done." claude &
pc=$!
claude_live() { who_json | jq -e 'any(.[]; .tool == "claude" and .live)' > /dev/null; }
wait_for 120 claude_live || fail "the Claude session never registered"
claude_name="$(who_json | jq -r '[.[] | select(.tool == "claude" and .live)][0].name')"
[ -n "$claude_name" ] && [ "$claude_name" != null ] || fail "no live Claude name"
say "claude session $claude_name"

run_host agy "$agy_name" "Run these 20 shell commands in order, one at a time, each as its own separate tool call, without combining them:
$(slow 20 agy)
If a message reaches you while you work asking you to send something with omsg, run exactly that omsg send as your next tool call, then carry on with the list. When all are done, say done." agy &
pa=$!
wait_for 120 alias_live "$agy_name" || fail "the agy worker never registered as $agy_name"

run_host codex - "Run this one shell command, then answer done:
omsg send $agy_name 'Relay request: please run: omsg send $claude_name \"Relayed code word $K\"'" codex
say "codex job finished"
wait "$pa" || say "agy exited $?"
wait "$pc" || say "claude exited $?"

leg() { cat "$OMSG_DIR"/log-"$1"*.jsonl 2> /dev/null | jq -c --arg k "$K" 'select(.body | contains($k)) | {from, to, body}'; }
codex_leg="$(leg codex)" agy_leg="$(leg agy)"
final="$(cat "$S/runs/claude.last" 2> /dev/null || true)"
echo "nonce=$K claude=$claude_name agy=$agy_name"
echo "codex -> agy: $codex_leg"
echo "agy -> claude: $agy_leg"
echo "claude final answer: $(tr '\n' ' ' <<< "$final" | cut -c1-400)"
for t in codex agy claude; do echo "self-run mail reads by $t: $(self_reads "$t" | tr '\n' ' ')"; done
grep -q "\"to\":\"[^\"]*agy" <<< "$codex_leg" || fail "no codex -> agy record with $K"
grep -q "\"to\":\"claude" <<< "$agy_leg" || fail "no agy -> claude record with $K"
grep -qF "$K" <<< "$final" || fail "Claude's final answer lacks $K"
for t in agy claude; do [ -z "$(self_reads "$t")" ] || fail "$t read its mail itself"; done
echo PASS
