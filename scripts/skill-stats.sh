#!/bin/bash
set -e
# Per-skill stats as TSV on stdout; status and violations on stderr.
# Columns: name, description chars, body lines, dash count,
#          non-portable frontmatter keys, Claude-syntax hits.
# Last line: always_loaded_tokens N (frontmatter chars of all skills and agents,
# plus CLAUDE.md and AGENTS.md, divided by 4).
# Usage: skill-stats.sh [--strict [skill]]

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$REPO/plugins/omnilogic-labs"
SYNTAX='subagent_type|SendMessage|TodoWrite|AskUserQuestion|mcp__|the (Agent|Task|Skill|Bash|Read|Write|Edit) tool'
PORTABLE=" name description license compatibility metadata allowed-tools "
MAX_DESC=500
MAX_BODY=500

STRICT=0
ONLY=""
if [ "${1:-}" = "--strict" ]; then
  STRICT=1
  ONLY="${2:-}"
fi

frontmatter() { awk '/^---$/{f++; next} f==1' "$1"; }
body() { awk 'f>=2; /^---$/{f++}' "$1"; }

fm_chars=0
violations=0
printf 'name\tdesc_chars\tbody_lines\tdashes\tnonportable_keys\tclaude_syntax\n'
for dir in "$PLUGIN"/skills/*/; do
  name="$(basename "$dir")"
  file="$dir/SKILL.md"
  [ -f "$file" ] || continue
  [ -z "$ONLY" ] || [ "$ONLY" = "$name" ] || continue
  fm="$(frontmatter "$file")"
  fm_chars=$((fm_chars + ${#fm}))
  # Description may be a scalar, a quoted scalar, or a block scalar.
  desc="$(printf '%s\n' "$fm" | awk '
    /^description:/ { sub(/^description:[ ]*/, ""); if ($0 ~ /^[|>][-+]?$/) { blk=1; next } print; blk=0; next }
    blk && /^[ ]+/ { sub(/^[ ]+/, ""); print; next }
    /^[^ ]/ { blk=0 }')"
  desc_chars=${#desc}
  body_lines="$(body "$file" | wc -l | tr -d ' ')"
  dashes="$(cat "$file" | grep -o '[—–]' | wc -l | tr -d ' ')"
  bad_keys=""
  for k in $(printf '%s\n' "$fm" | grep -oE '^[A-Za-z][A-Za-z0-9_-]*:' | tr -d ':'); do
    case "$PORTABLE" in *" $k "*) ;; *) bad_keys="$bad_keys${bad_keys:+,}$k" ;; esac
  done
  syntax="$(body "$file" | grep -cE "$SYNTAX" || true)"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$desc_chars" "$body_lines" "$dashes" "${bad_keys:--}" "$syntax"
  if [ "$desc_chars" -gt "$MAX_DESC" ] || [ "$body_lines" -gt "$MAX_BODY" ] || [ "$dashes" -gt 0 ] || [ -n "$bad_keys" ] || [ "$syntax" -gt 0 ]; then
    echo "violation: $name (desc=$desc_chars body=$body_lines dashes=$dashes keys=${bad_keys:--} syntax=$syntax)" >&2
    violations=$((violations + 1))
  fi
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
