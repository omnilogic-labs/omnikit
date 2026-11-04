#!/bin/bash
# owner.sh [codex|agy ...]: the job sends the owner a question with nonce Q; a
# plain shell (detached with setsid, so no agent is among its ancestors, and no
# --as) runs `omsg read`, then `omsg reply <id>` with nonce R. Passes when the
# owner's read shows Q and the job's final answer echoes R.
set -e
source "$(dirname "$(realpath "$0")")/lib.sh"
[ $# -gt 0 ] || set -- codex agy

# plain <tag> <command>: runs the command in a detached shell; prints its output.
plain() {
  local tag="$1" cmd="$2"
  rm -f "$S/runs/$tag.rc"
  setsid -f env -u OMSG_NAME bash -c "
    echo \"plain shell pid \$\$ parent \$(ps -o ppid= -p \$\$ | tr -d ' ') (\$(ps -o comm= -p \$(ps -o ppid= -p \$\$)))\" > '$S/runs/$tag.out'
    $cmd >> '$S/runs/$tag.out' 2>&1; echo \$? > '$S/runs/$tag.rc'"
  wait_for 30 test -s "$S/runs/$tag.rc" || fail "plain shell $tag did not finish"
  cat "$S/runs/$tag.out"
}

bad=0
for host in "$@"; do
  (
    setup "owner-$host"
    Q="$(nonce)" R="$(nonce)"
    steps=""
    for i in $(seq 1 12); do steps+="$((i + 1)). \`sleep 3; echo wait $i\`"$'\n'; done
    prompt="Run these shell commands in order, one at a time, each as its own separate tool call; never combine them and run nothing else:
1. \`omsg send owner \"Question $Q: what is the code word?\"\`
$steps
When all are done, your final answer must quote verbatim every message you received while working (if any), then say done."
    run_host "$host" "owner-$host-$$" "$prompt" owner &
    job=$!
    wait_for 180 test -e "$OMSG_DIR/notify/owner" || fail "$host never wrote to the owner"
    echo "== owner: omsg read"
    got="$(plain read "omsg read")"
    echo "$got"
    grep -qF "$Q" <<< "$got" || fail "the owner's read lacks $Q"
    id="$(grep -F "$Q" <<< "$got" | sed -n 's/.*\[\([0-9a-f]*\)\].*/\1/p' | head -1)"
    [ -n "$id" ] || fail "no message id in the owner's read"
    echo "== owner: omsg reply $id"
    plain reply "omsg reply $id 'The code word is $R. Put it in your final answer.'"
    wait "$job" || say "job exited $?"
    final="$(cat "$S/runs/owner.last" 2> /dev/null || true)"
    reads="$(self_reads owner)"
    echo "host=$host Q=$Q R=$R"
    echo "final answer: $(tr '\n' ' ' <<< "$final" | cut -c1-400)"
    echo "self-run mail reads: ${reads:-none}"
    grep -qF "$R" <<< "$final" || fail "$host final answer lacks $R"
    [ -z "$reads" ] || fail "$host read its mail itself"
    echo "PASS $host"
  ) || bad=1
done
exit $bad
