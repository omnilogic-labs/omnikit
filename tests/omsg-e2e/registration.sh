#!/bin/bash
# registration.sh [codex|agy ...]: three jobs of one host run at once in the
# same project: A (no alias, killed with kill -9), B (alias, killed with
# kill -9) and C (no alias, exits normally). Passes when `omsg who` lists all
# three as distinct live entries while they run, C is gone after its normal
# exit, A is gone after kill -9 of its host process, and B is listed offline
# (an aliased session keeps its name so mail to it queues).
set -e
source "$(dirname "$(realpath "$0")")/lib.sh"
[ $# -gt 0 ] || set -- codex agy

slow() {
  local n="$1" tag="$2" steps=""
  for i in $(seq 1 "$n"); do steps+="$i. \`sleep 3; echo $tag $i\`"$'\n'; done
  echo "Run these $n shell commands in order, one at a time, each as its own separate tool call; never combine them and run nothing else:
$steps
Then answer done."
}

# sid_of <host> <tag>: the job's session id, from its event stream.
sid_of() {
  if [ "$1" = codex ]; then
    jq -r 'select(.type == "thread.started") | .thread_id' "$S/runs/$2.jsonl" 2> /dev/null | head -1
  else
    jq -r 'select(.event == "init") | .conversation_id' "$S/runs/$2.jsonl" 2> /dev/null | head -1
  fi
}
entry() { who_json | jq -c --arg s "$1" '.[] | select(.sid == $s)'; }
has_sid() { [ -n "$(sid_of "$1" "$2")" ]; }
listed_live() { [ "$(entry "$1" | jq -r .live)" = true ]; }

bad=0
for host in "$@"; do
  (
    setup "reg-$host"
    alias="reg-$host-$$"
    run_host "$host" - "$(slow 40 a)" A &
    pa=$!
    run_host "$host" "$alias" "$(slow 40 b)" B &
    pb=$!
    run_host "$host" - "$(slow 4 c)" C &
    pc=$!
    for t in A B C; do wait_for 120 has_sid "$host" "$t" || fail "$host job $t never started"; done
    sa=$(sid_of "$host" A) sb=$(sid_of "$host" B) sc=$(sid_of "$host" C)
    for s in "$sa" "$sb" "$sc"; do wait_for 60 listed_live "$s" || {
      omsg --as owner who >&2
      fail "$host session $s is not listed live while running"
    }; done
    echo "$host while running (omsg who):"
    omsg --as owner who | sed 's/^/  /'
    names=$(for s in "$sa" "$sb" "$sc"; do entry "$s" | jq -r .name; done | sort -u | wc -l)
    [ "$names" -eq 3 ] || fail "$host: three sessions share $names name(s)"

    wait "$pc" || say "C exited $?"
    [ -z "$(entry "$sc")" ] || fail "$host C still listed after its normal exit: $(entry "$sc")"
    echo "$host C after normal exit: absent"

    ka=$(entry "$sa" | jq -r .pid) kb=$(entry "$sb" | jq -r .pid)
    say "kill -9 $ka (A) and $kb (B): $(ps -o comm= -p "$ka") $(ps -o comm= -p "$kb")"
    kill -9 "$ka" "$kb"
    wait "$pa" || true
    wait "$pb" || true
    wait_for 10 bash -c "! kill -0 $ka 2> /dev/null && ! kill -0 $kb 2> /dev/null"
    echo "$host after kill -9 (omsg who):"
    omsg --as owner who | sed 's/^/  /'
    [ -z "$(entry "$sa")" ] || fail "$host A still listed after kill -9: $(entry "$sa")"
    echo "$host A after kill -9: absent"
    [ "$(entry "$sb" | jq -r .live)" = false ] || fail "$host B not offline after kill -9: $(entry "$sb")"
    echo "$host B (alias $alias) after kill -9: offline"
    echo "PASS $host"
  ) || bad=1
done
exit $bad
