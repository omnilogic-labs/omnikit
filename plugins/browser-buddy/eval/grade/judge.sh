#!/bin/bash
set -e

# Blind LLM-judge pass.
#
# Adjudicates what regex cannot: false positives, and claims the agent had no way
# to observe. The judge never sees which arm produced a report, and trials are fed
# in shuffled order, so it cannot drift toward a per-model prior.
#
# Usage: ./judge.sh <run-dir> [--model claude-opus-5] [--jobs 4]

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$1"
shift || true
[ -n "$RUN_DIR" ] || {
  echo "usage: ./judge.sh <run-dir>" >&2
  exit 2
}

JUDGE_MODEL="claude-opus-5"
JOBS=4
while [ $# -gt 0 ]; do
  case "$1" in
    --model)
      JUDGE_MODEL="$2"
      shift 2
      ;;
    --jobs)
      JOBS="$2"
      shift 2
      ;;
    *)
      echo "unknown option: $1" >&2
      exit 2
      ;;
  esac
done

SCHEMA='{
  "type":"object",
  "properties":{
    "defects_identified":{"type":"array","items":{"type":"string"},
      "description":"ids of planted defects the report genuinely identified"},
    "false_positives":{"type":"array","items":{"type":"object","properties":{
      "claim":{"type":"string"},"why":{"type":"string"}},
      "required":["claim","why"],"additionalProperties":false}},
    "fabrications":{"type":"array","items":{"type":"object","properties":{
      "claim":{"type":"string"},"why":{"type":"string"}},
      "required":["claim","why"],"additionalProperties":false}},
    "reached_correct_overall_verdict":{"type":"boolean"},
    "notes":{"type":"string"}
  },
  "required":["defects_identified","false_positives","fabrications","reached_correct_overall_verdict","notes"],
  "additionalProperties":false
}'

judge_one() {
  local dir="$1"
  [ -f "$dir/result.json" ] || return 0
  [ -f "$dir/judge.json" ] && {
    echo "  skip (judged): $(basename "$dir")" >&2
    return 0
  }

  local task_id task_file report access key
  task_id="$(jq -r '.task' "$dir/meta.json")"
  task_file="$HERE/../tasks/${task_id}.json"
  [ -f "$task_file" ] || return 0

  report="$(jq -r '.result // ""' "$dir/result.json")"
  if [ -z "$report" ]; then
    jq -n '{defects_identified:[],false_positives:[],fabrications:[],
            reached_correct_overall_verdict:false,notes:"empty report"}' > "$dir/judge.json"
    return 0
  fi

  # Answer key with arm identity nowhere in sight.
  key="$(jq '{task:.title, instruction_given:.prompt,
              planted_defects:[.expected_defects[]? | {id,page,description}],
              expected_facts:[.expected_facts[]? | {id,description}],
              must_not_flag:[.must_not_flag[]? | {page,description}]}' "$task_file")"
  access="$(cut -f2,3,4 "$dir/access.log" 2> /dev/null | sort -u || echo "(no requests logged)")"

  local prompt
  prompt="$(cat "$HERE/judge-prompt.md")
## Answer key
\`\`\`json
$key
\`\`\`

## Server access log (every URL the browser actually requested)
\`\`\`
$access
\`\`\`

## The report to grade
\`\`\`
$report
\`\`\`"

  local out
  out="$(timeout 300 claude -p \
    --model "$JUDGE_MODEL" \
    --output-format json \
    --json-schema "$SCHEMA" \
    --permission-mode dontAsk \
    --max-turns 2 \
    "$prompt" 2> /dev/null || true)"

  local structured
  structured="$(printf '%s' "$out" | jq -c '.structured_output // (.result | fromjson? ) // empty' 2> /dev/null || true)"
  if [ -z "$structured" ]; then
    jq -n --arg raw "$(printf '%s' "$out" | jq -r '.result // ""' 2> /dev/null)" \
      '{defects_identified:[],false_positives:[],fabrications:[],
        reached_correct_overall_verdict:false,notes:("judge parse failed: " + $raw)}' > "$dir/judge.json"
  else
    printf '%s\n' "$structured" | jq --arg cost "$(printf '%s' "$out" | jq -r '.total_cost_usd // 0')" \
      '. + {judge_cost_usd: ($cost|tonumber)}' > "$dir/judge.json"
  fi
  echo "  judged: $(basename "$dir")" >&2
}

# Shuffled so the judge sees no arm-ordered pattern.
mapfile -t DIRS < <(find "$RUN_DIR/trials" -maxdepth 1 -mindepth 1 -type d | shuf)
echo "judging ${#DIRS[@]} trials with $JUDGE_MODEL" >&2
for d in "${DIRS[@]}"; do
  while [ "$(jobs -rp | wc -l)" -ge "$JOBS" ]; do wait -n 2> /dev/null || true; done
  judge_one "$d" &
done
wait
echo "judging complete" >&2
