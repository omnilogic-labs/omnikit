#!/bin/bash
# Kept for muscle memory. install.sh now links skills, agents, and commands in
# one pass, for Claude Code, Codex, and Gemini.
set -e
echo "link-skills.sh is now install.sh --claude" >&2
exec "$(cd "$(dirname "$0")" && pwd)/install.sh" --claude --no-deps "$@"
