#!/bin/bash
set -e
# Per-skill stats as TSV on stdout; status and violations on stderr.
# Columns: name, description chars, body lines, dash count,
#          non-portable frontmatter keys, Claude-syntax hits.
# Rows cover every generated SKILL.md, named <host>/<skill>: claude (the
# plugin), codex and agy (dist/, built into a temp dir when missing), and the
# portable root skills/ tree: portable/<skill> for each dispatcher SKILL.md and
# portable/<skill>/<host> for each platforms/<host>.md (whole file is the body).
# The Claude-syntax check applies to codex and agy output only; "-" means
# not checked.
# Last line: always_loaded_tokens N (frontmatter chars of the plugin's skills
# and agents, plus CLAUDE.md and AGENTS.md, divided by 4).
# Usage: skill-stats.sh [--strict [skill]]

REPO="$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/.." && pwd)"
PLUGIN="$REPO/plugins/omnilogic-labs"
SYNTAX='subagent_type|SendMessage|TodoWrite|AskUserQuestion|mcp__|the (Agent|Task|Skill|Bash|Read|Write|Edit) tool'
PORTABLE=" name description license compatibility metadata allowed-tools "
MAX_DESC=300
MAX_BODY=150

STRICT=0
ONLY=""
if [ "${1:-}" = "--strict" ]; then
  STRICT=1
  ONLY="${2:-}"
fi

frontmatter() { awk '/^---$/{f++; next} f==1' "$1"; }
body() { awk 'f>=2; /^---$/{f++}' "$1"; }
count_dashes() { grep -o -e "$(printf '\342\200\224')" -e "$(printf '\342\200\223')" "$1" | wc -l | tr -d ' '; }

# The codex and agy trees are machine-local. Use dist/ when it is there,
# otherwise build into a temp dir so the stats never depend on an install.
DIST="$REPO/dist"
if [ ! -d "$DIST/codex/skills" ] || [ ! -d "$DIST/agy/skills" ]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  echo "dist/ not built; building into a temp dir" >&2
  (cd "$REPO" && bun scripts/build/build.ts --out "$TMP" >&2)
  DIST="$TMP/dist"
fi

fm_chars=0
violations=0

# violation <row> <reason...>
violation() {
  echo "violation: $*" >&2
  violations=$((violations + 1))
}

# skill_row <host> <name> <file> <check-syntax>
skill_row() {
  local host="$1" name="$2" file="$3" check_syntax="$4" fm desc desc_chars body_lines dashes bad_keys k syntax
  fm="$(frontmatter "$file")"
  [ "$host" = claude ] && fm_chars=$((fm_chars + ${#fm}))
  # Description may be a scalar, a quoted scalar, or a block scalar.
  desc="$(printf '%s\n' "$fm" | awk '
    /^description:/ { sub(/^description:[ ]*/, ""); if ($0 ~ /^[|>][-+]?$/) { blk=1; next } print; blk=0; next }
    blk && /^[ ]+/ { sub(/^[ ]+/, ""); print; next }
    /^[^ ]/ { blk=0 }')"
  desc_chars=${#desc}
  body_lines="$(body "$file" | wc -l | tr -d ' ')"
  dashes="$(count_dashes "$file")"
  bad_keys=""
  for k in $(printf '%s\n' "$fm" | grep -oE '^[A-Za-z][A-Za-z0-9_-]*:' | tr -d ':'); do
    case "$PORTABLE" in *" $k "*) ;; *) bad_keys="$bad_keys${bad_keys:+,}$k" ;; esac
  done
  if $check_syntax; then
    syntax="$(body "$file" | grep -cE "$SYNTAX" || true)"
  else
    syntax="-"
  fi
  printf '%s/%s\t%s\t%s\t%s\t%s\t%s\n' "$host" "$name" "$desc_chars" "$body_lines" "$dashes" "${bad_keys:--}" "$syntax"
  if [ "$desc_chars" -gt "$MAX_DESC" ] || [ "$body_lines" -gt "$MAX_BODY" ] || [ "$dashes" -gt 0 ] \
    || [ -n "$bad_keys" ] || { [ "$syntax" != "-" ] && [ "$syntax" -gt 0 ]; }; then
    violation "$host/$name (desc=$desc_chars body=$body_lines dashes=$dashes keys=${bad_keys:--} syntax=$syntax)"
  fi
}

# platform_row <name> <host> <file>: a platform file has no frontmatter, so
# the whole file is the body.
platform_row() {
  local name="$1" host="$2" file="$3" body_lines dashes
  body_lines="$(wc -l < "$file" | tr -d ' ')"
  dashes="$(count_dashes "$file")"
  printf 'portable/%s/%s\t-\t%s\t%s\t-\t-\n' "$name" "$host" "$body_lines" "$dashes"
  if [ "$body_lines" -gt "$MAX_BODY" ] || [ "$dashes" -gt 0 ]; then
    violation "portable/$name/$host (body=$body_lines dashes=$dashes)"
  fi
}

# host_rows <host> <skills-dir> <check-syntax>
host_rows() {
  local host="$1" root="$2" check_syntax="$3" dir name
  for dir in "$root"/*/; do
    name="$(basename "$dir")"
    [ -f "$dir/SKILL.md" ] || continue
    [ -z "$ONLY" ] || [ "$ONLY" = "$name" ] || continue
    skill_row "$host" "$name" "$dir/SKILL.md" "$check_syntax"
  done
}

printf 'name\tdesc_chars\tbody_lines\tdashes\tnonportable_keys\tclaude_syntax\n'
host_rows claude "$PLUGIN/skills" false
host_rows codex "$DIST/codex/skills" true
host_rows agy "$DIST/agy/skills" true
host_rows portable "$REPO/skills" false
for dir in "$REPO"/skills/*/; do
  name="$(basename "$dir")"
  [ -z "$ONLY" ] || [ "$ONLY" = "$name" ] || continue
  for f in "$dir"platforms/*.md; do
    [ -f "$f" ] || continue
    platform_row "$name" "$(basename "$f" .md)" "$f"
  done
done

for f in "$PLUGIN"/agents/*.md; do
  [ -f "$f" ] || continue
  fm="$(frontmatter "$f")"
  fm_chars=$((fm_chars + ${#fm}))
done
extra=0
for f in "$REPO/CLAUDE.md" "$REPO/AGENTS.md"; do
  [ -f "$f" ] && extra=$((extra + $(wc -c < "$f")))
done
echo "always_loaded_tokens $(((fm_chars + extra) / 4))"

if [ "$STRICT" = 1 ] && [ "$violations" -gt 0 ]; then
  exit 1
fi
