#!/usr/bin/env bash
# board-scan.sh - the deterministic half of task-triage.
#
# Fetches an issue board in bulk, buckets everything decidable from labels
# alone, drops issues unchanged since the last run, and writes the survivors
# into slice files for the scouts to read. Nothing here is a judgement call,
# which is why it is a script and not a paragraph.
#
#   scan    fetch the board, emit a manifest, write slice files
#   record  save this run's buckets so the next scan can reuse them
#
# Status goes to stderr, the manifest to stdout.
set -euo pipefail

usage() {
  cat >&2 << 'EOF'
usage:
  board-scan.sh scan   --repo <owner/repo> --out <dir> [--hold <list>] [--slices <n>]
  board-scan.sh record --out <dir> < digest-lines

scan options:
  --repo    owner/repo to read (required)
  --out     scratch directory for slices and cache (required)
  --hold    issue numbers always bucketed HOLD, comma separated,
            ranges allowed: "117-122,140"
  --slices  how many slice files to split the read set into (default 6)
  --no-cache  ignore any previous digest and re-read the whole board

record reads lines of "<number> <bucket> <rest...>" on stdin and stores them
against the updatedAt seen by the most recent scan.
EOF
  exit 2
}

need() { command -v "$1" > /dev/null || {
  echo "board-scan: missing $1" >&2
  exit 1
}; }
need gh
need jq

CMD="${1:-}"
shift || usage
REPO=""
OUT=""
HOLD=""
SLICES=6
USE_CACHE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --repo)
      REPO="$2"
      shift 2
      ;;
    --out)
      OUT="$2"
      shift 2
      ;;
    --hold)
      HOLD="$2"
      shift 2
      ;;
    --slices)
      SLICES="$2"
      shift 2
      ;;
    --no-cache)
      USE_CACHE=0
      shift
      ;;
    *) usage ;;
  esac
done
[ -n "$OUT" ] || usage
mkdir -p "$OUT"
CACHE="$OUT/triage-cache.json"
BOARD="$OUT/board.json"

# Expand "117-122,140" into a JSON array of numbers.
hold_json() {
  [ -n "$HOLD" ] || {
    echo '[]'
    return
  }
  echo "$HOLD" | tr ',' '\n' | while read -r part; do
    [ -n "$part" ] || continue
    case "$part" in
      *-*) seq "${part%%-*}" "${part##*-}" ;;
      *) echo "$part" ;;
    esac
  done | jq -R 'tonumber' | jq -sc .
}

cmd_record() {
  [ -f "$BOARD" ] || {
    echo "board-scan: no board.json in $OUT; run scan first" >&2
    exit 1
  }
  # stdin: "<number> <bucket> <rest>" per line. Store bucket + the updatedAt
  # this run actually saw, so a later scan can compare against it honestly.
  jq -R 'capture("^\\s*#?(?<n>[0-9]+)\\s+(?<bucket>\\S+)(\\s+(?<note>.*))?$") // empty' \
    | jq -sc 'map({key:.n, value:{bucket:.bucket, note:(.note//"")}}) | from_entries' > "$OUT/.rec.json"
  jq -n --slurpfile b "$BOARD" --slurpfile r "$OUT/.rec.json" '
    ($b[0] | map({key:(.number|tostring), value:.updatedAt}) | from_entries) as $seen
    | $r[0] | to_entries
    | map(select($seen[.key] != null)
          | {key:.key, value:{updatedAt:$seen[.key], bucket:.value.bucket, note:.value.note}})
    | from_entries' > "$CACHE.tmp"
  mv "$CACHE.tmp" "$CACHE"
  echo "board-scan: recorded $(jq 'length' "$CACHE") buckets to $CACHE" >&2
}

cmd_scan() {
  [ -n "$REPO" ] || usage

  echo "board-scan: fetching $REPO" >&2
  : > "$OUT/.pages.json"
  page=1
  while :; do
    raw="$OUT/.page.json"
    gh api "repos/$REPO/issues?state=open&per_page=100&page=$page" > "$raw"
    # Page fullness is decided by the RAW count. Filtering pull requests out
    # first makes a full page look short and stops paging early.
    raw_n=$(jq 'length' "$raw")
    jq -c '[.[] | select(.pull_request==null)
           | {number, title, updatedAt:.updated_at, comments,
              labels:[.labels[].name], body:(.body//"")}]' "$raw" >> "$OUT/.pages.json"
    rm -f "$raw"
    [ "$raw_n" -eq 100 ] || break
    page=$((page + 1))
  done
  jq -sc 'add // []' "$OUT/.pages.json" > "$BOARD"
  rm -f "$OUT/.pages.json"
  total=$(jq 'length' "$BOARD")
  echo "board-scan: $total open issues in $page page(s)" >&2

  if [ "$USE_CACHE" -eq 1 ] && [ -f "$CACHE" ]; then
    cp "$CACHE" "$OUT/.cache-in.json"
  else
    echo '{}' > "$OUT/.cache-in.json"
  fi

  # One pass assigns every issue to prefiltered / reused / read.
  jq -c --argjson hold "$(hold_json)" --slurpfile cache "$OUT/.cache-in.json" '
    ($cache[0] // {}) as $c
    | map(
        . as $i
        | (.labels | map(ascii_downcase)) as $l
        | . + {klass:
            (if ($hold | index($i.number)) then "HOLD"
             elif ($l | index("epic")) then "EPIC"
             elif ($l | any(. == "question" or (startswith("needs-") and endswith("-input")))) then "FEEDBACK"
             elif ($c[$i.number|tostring].updatedAt == $i.updatedAt) then "REUSED"
             else "READ" end)}
      )' "$BOARD" > "$OUT/.classified.json"
  rm -f "$OUT/.cache-in.json"

  emit() { # klass label
    ns=$(jq -r --arg k "$1" '[.[] | select(.klass==$k) | "#\(.number)"] | join(",")' "$OUT/.classified.json")
    c=$(jq -r --arg k "$1" '[.[] | select(.klass==$k)] | length' "$OUT/.classified.json")
    [ "$c" -gt 0 ] && echo "PREFILTERED $2 $c $ns" || true
  }
  emit HOLD hold
  emit EPIC epic
  emit FEEDBACK feedback

  reused=$(jq '[.[] | select(.klass=="REUSED")] | length' "$OUT/.classified.json")
  if [ "$reused" -gt 0 ]; then
    echo "REUSED $reused"
    jq -r --slurpfile c "$CACHE" '
      .[] | select(.klass=="REUSED")
      | "  #\(.number) \($c[0][.number|tostring].bucket) \($c[0][.number|tostring].note)"' \
      "$OUT/.classified.json"
  fi

  # Everything left gets its body, and its comments if it has any, written to
  # slice files. Comment count comes from the list payload, so an issue with
  # zero comments costs zero extra calls.
  read_ns=$(jq -r '[.[] | select(.klass=="READ") | .number] | sort | join(" ")' "$OUT/.classified.json")
  read_ct=$(echo "$read_ns" | wc -w | tr -d ' ')
  echo "TO_READ $read_ct"
  [ "$read_ct" -gt 0 ] || {
    rm -f "$OUT/.classified.json"
    return 0
  }

  per=$(((read_ct + SLICES - 1) / SLICES))
  [ "$per" -lt 1 ] && per=1
  i=0
  slice=""
  lo=""
  flush() {
    [ -n "$slice" ] || return 0
    hi=$(echo "$slice" | awk '{print $NF}')
    f="$OUT/issues_${lo}-${hi}.txt"
    : > "$f"
    for n in $slice; do
      {
        echo "=====ISSUE $n"
        jq -r --argjson n "$n" '.[] | select(.number==$n)
          | "TITLE: \(.title)\nLABELS: \(.labels|join(","))\nUPDATED: \(.updatedAt)\n\n\(.body)"' "$BOARD"
        cc=$(jq -r --argjson n "$n" '.[] | select(.number==$n) | .comments' "$BOARD")
        if [ "$cc" -gt 0 ]; then
          echo
          echo "----- COMMENTS ($cc)"
          gh api "repos/$REPO/issues/$n/comments" \
            --jq '.[] | "--- @\(.user.login) \(.created_at)\n\(.body)"' || true
        fi
      } >> "$f"
    done
    echo "SLICE $f $(echo "$slice" | tr ' ' ',')"
    slice=""
    lo=""
  }
  for n in $read_ns; do
    [ -n "$lo" ] || lo="$n"
    slice="$slice $n"
    slice="${slice# }"
    i=$((i + 1))
    [ $((i % per)) -eq 0 ] && flush
  done
  flush
  rm -f "$OUT/.classified.json"
  echo "board-scan: $read_ct issues need a body read" >&2
}

case "$CMD" in
  scan) cmd_scan ;;
  record) cmd_record ;;
  *) usage ;;
esac
