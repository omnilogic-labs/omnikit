#!/bin/bash
set -e

# browser-buddy model/effort evaluation runner.
#
# Every trial is an isolated `claude -p` subprocess running the real
# browser-buddy prompt, differing only in --model and --effort. Each trial gets
# its own fixture server on its own port, so the server access log is an exact
# record of what that trial actually visited.
#
# Usage:
#   ./run.sh --reps 5
#   ./run.sh --reps 1 --arms sonnet-med --tasks t3-extraction
#   ./run.sh --reps 5 --jobs 3 --out ~/.cache/browser-buddy-eval

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN="$(cd "$HERE/.." && pwd)"
AGENT_FILE="$PLUGIN/agents/browser-buddy.md"

REPS=1
JOBS=3
PORT_BASE=8900
OUT_ROOT="$HOME/.cache/browser-buddy-eval"
RUN_ID=""
ONLY_ARMS=""
ONLY_TASKS=""
# These are runaway backstops, not part of the test. Production imposes no turn
# limit on browser-buddy (the agent file sets no maxTurns), so a guard that binds
# would be measuring the harness rather than the agent. Any trial that does hit
# one returns no report at all, and is scored as incomplete rather than as a
# wrong answer. Per-task max_turns live in tasks/*.json and are set well above
# observed usage for the same reason.
MAX_BUDGET="5.00"
TRIAL_TIMEOUT=1800

while [ $# -gt 0 ]; do
  case "$1" in
    --reps)
      REPS="$2"
      shift 2
      ;;
    --jobs)
      JOBS="$2"
      shift 2
      ;;
    --out)
      OUT_ROOT="$2"
      shift 2
      ;;
    --run-id)
      RUN_ID="$2"
      shift 2
      ;;
    --arms)
      ONLY_ARMS="$2"
      shift 2
      ;;
    --tasks)
      ONLY_TASKS="$2"
      shift 2
      ;;
    --port-base)
      PORT_BASE="$2"
      shift 2
      ;;
    --max-budget)
      MAX_BUDGET="$2"
      shift 2
      ;;
    --timeout)
      TRIAL_TIMEOUT="$2"
      shift 2
      ;;
    -h | --help)
      sed -n '3,16p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      exit 2
      ;;
  esac
done

command -v jq > /dev/null || {
  echo "jq is required" >&2
  exit 1
}
command -v node > /dev/null || {
  echo "node is required" >&2
  exit 1
}
command -v claude > /dev/null || {
  echo "claude CLI is required" >&2
  exit 1
}
command -v agent-browser > /dev/null || {
  echo "agent-browser is required" >&2
  exit 1
}

[ -n "$RUN_ID" ] || RUN_ID="run-$(date +%Y%m%d-%H%M%S)"
RUN_DIR="$OUT_ROOT/$RUN_ID"
mkdir -p "$RUN_DIR"

# The agent prompt under test is the real one, read from the plugin at run time.
# model and effort are deliberately NOT copied into the agent JSON: the session
# flags govern, so there is exactly one place each arm's configuration comes from.
AGENT_BODY="$RUN_DIR/agent-body.md"
awk 'BEGIN{d=0} /^---[[:space:]]*$/{d++; next} d>=2{print}' "$AGENT_FILE" > "$AGENT_BODY"
[ -s "$AGENT_BODY" ] || {
  echo "failed to extract agent prompt body from $AGENT_FILE" >&2
  exit 1
}

echo "run:      $RUN_DIR" >&2
echo "agent:    $AGENT_FILE ($(wc -l < "$AGENT_BODY") lines of prompt)" >&2
echo "reps:     $REPS   jobs: $JOBS" >&2

mapfile -t ARM_IDS < <(jq -r '.[].id' "$HERE/arms.json")
mapfile -t TASK_FILES < <(ls "$HERE"/tasks/*.json | sort)

run_trial() {
  local arm_id="$1" task_file="$2" rep="$3" port="$4"
  local task_id trial_id trial_dir
  task_id="$(jq -r '.id' "$task_file")"
  trial_id="${arm_id}__${task_id}__r${rep}"
  trial_dir="$RUN_DIR/trials/$trial_id"

  if [ -f "$trial_dir/result.json" ]; then
    echo "  skip (done): $trial_id" >&2
    return 0
  fi

  mkdir -p "$trial_dir/screenshots"
  local access_log="$trial_dir/access.log"
  : > "$access_log"

  # Dedicated fixture server per trial, so the access log belongs to this trial alone.
  PORT="$port" LOG="$access_log" node "$HERE/fixtures/server.mjs" > "$trial_dir/server.log" 2>&1 &
  local server_pid=$!
  local waited=0
  while ! curl -sf -o /dev/null "http://localhost:$port/" 2> /dev/null; do
    sleep 0.2
    waited=$((waited + 1))
    if [ $waited -gt 50 ]; then
      echo "  FAIL server did not start: $trial_id" >&2
      kill "$server_pid" 2> /dev/null || true
      return 1
    fi
  done

  local model effort prompt
  model="$(jq -r --arg a "$arm_id" '.[] | select(.id==$a) | .model' "$HERE/arms.json")"
  effort="$(jq -r --arg a "$arm_id" '.[] | select(.id==$a) | .effort // ""' "$HERE/arms.json")"
  prompt="$(jq -r '.prompt' "$task_file" | sed "s|{{BASE}}|http://localhost:$port|g")"
  local max_turns
  max_turns="$(jq -r '.max_turns // 50' "$task_file")"

  # Mirrors the real frontmatter: same tools, same preloaded skill, same prompt.
  local agents_json
  agents_json="$(jq -nc --rawfile body "$AGENT_BODY" \
    '{"browser-buddy-eval":{
        "description":"Autonomous browser operator under evaluation.",
        "prompt":$body,
        "tools":["Bash","Read","Write","Glob","Grep"],
        "skills":["agent-browser"]
      }}')"

  local -a effort_flag=()
  [ -n "$effort" ] && effort_flag=(--effort "$effort")

  jq -n --arg trial "$trial_id" --arg arm "$arm_id" --arg task "$task_id" \
    --arg model "$model" --arg effort "$effort" --arg prompt "$prompt" \
    --argjson rep "$rep" --argjson port "$port" \
    '{trial_id:$trial,arm:$arm,task:$task,rep:$rep,port:$port,model:$model,effort:$effort,prompt:$prompt}' \
    > "$trial_dir/meta.json"

  local started ended rc=0
  started="$(date +%s)"
  set +e
  (
    cd "$trial_dir" \
      && AGENT_BROWSER_SCREENSHOT_DIR="$trial_dir/screenshots" \
        timeout "$TRIAL_TIMEOUT" claude -p \
        --output-format stream-json --verbose \
        --model "$model" "${effort_flag[@]}" \
        --agents "$agents_json" \
        --agent browser-buddy-eval \
        --permission-mode acceptEdits \
        --allowedTools "Bash" "Read" "Write" "Glob" "Grep" \
        --max-turns "$max_turns" \
        --max-budget-usd "$MAX_BUDGET" \
        "$prompt"
  ) > "$trial_dir/stream.jsonl" 2> "$trial_dir/stderr.log"
  rc=$?
  set -e
  ended="$(date +%s)"

  kill "$server_pid" 2> /dev/null || true
  wait "$server_pid" 2> /dev/null || true

  # Any agent-browser session this trial opened but did not close is a leak.
  # Detect it, record it, then clean it up so the machine does not accumulate Chrome.
  local leaked=0
  local sessions
  sessions="$(grep -oE '\-\-session[= ]+[A-Za-z0-9_.-]+' "$trial_dir/stream.jsonl" 2> /dev/null \
    | sed -E 's/--session[= ]+//' | sort -u || true)"
  if [ -n "$sessions" ]; then
    local live
    live="$(agent-browser session list 2> /dev/null || true)"
    while IFS= read -r s; do
      [ -n "$s" ] || continue
      if printf '%s' "$live" | grep -qF -- "$s"; then
        leaked=$((leaked + 1))
        agent-browser --session "$s" close > /dev/null 2>&1 || true
      fi
    done <<< "$sessions"
  fi

  # The last stream-json line of type "result" carries cost and usage.
  local result
  result="$(grep '"type":"result"' "$trial_dir/stream.jsonl" 2> /dev/null | tail -1 || true)"
  if [ -z "$result" ]; then
    result="$(jq -nc --argjson rc "$rc" \
      '{is_error:true,subtype:"no_result_line",exit_code:$rc,total_cost_usd:0,num_turns:0,result:""}')"
  fi
  printf '%s\n' "$result" | jq --argjson rc "$rc" --argjson leaked "$leaked" \
    --argjson wall "$((ended - started))" \
    '. + {exit_code:$rc, leaked_sessions:$leaked, wall_seconds:$wall}' \
    > "$trial_dir/result.json"

  local cost turns
  cost="$(jq -r '.total_cost_usd // 0' "$trial_dir/result.json")"
  turns="$(jq -r '.num_turns // 0' "$trial_dir/result.json")"
  echo "  done: $trial_id  cost=\$$cost turns=$turns wall=$((ended - started))s leak=$leaked rc=$rc" >&2
}

idx=0
declare -a PIDS=()
for rep in $(seq 1 "$REPS"); do
  for arm_id in "${ARM_IDS[@]}"; do
    [ -z "$ONLY_ARMS" ] || [[ ",$ONLY_ARMS," == *",$arm_id,"* ]] || continue
    for task_file in "${TASK_FILES[@]}"; do
      tid="$(jq -r '.id' "$task_file")"
      [ -z "$ONLY_TASKS" ] || [[ ",$ONLY_TASKS," == *",$tid,"* ]] || continue

      while [ "$(jobs -rp | wc -l)" -ge "$JOBS" ]; do wait -n 2> /dev/null || true; done
      port=$((PORT_BASE + (idx % 200)))
      idx=$((idx + 1))
      run_trial "$arm_id" "$task_file" "$rep" "$port" &
      PIDS+=($!)
    done
  done
done

for pid in "${PIDS[@]}"; do wait "$pid" 2> /dev/null || true; done

echo "" >&2
echo "all trials complete: $RUN_DIR/trials" >&2
echo "grade with: node $HERE/grade/deterministic.mjs $RUN_DIR" >&2
