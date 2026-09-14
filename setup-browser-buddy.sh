#!/bin/bash
# Bootstrap the browser-buddy plugin: vendor the agent-browser binary, download
# Chrome for Testing, and put `agent-browser` on your PATH so it runs from any
# directory. Safe to re-run; status goes to stderr.
set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
WRAPPER="$REPO_ROOT/plugins/browser-buddy/bin/agent-browser"
BIN_DIR="$HOME/.local/bin"
LINK="$BIN_DIR/agent-browser"

echo "browser-buddy setup" >&2
echo "===================" >&2

# 1. Vendor agent-browser. Its postinstall hook downloads the platform-specific
#    native binary.
if ! command -v bun &> /dev/null; then
  echo "error: bun is required but not found. Install it from https://bun.sh and re-run." >&2
  exit 1
fi
echo "Installing workspace dependencies (bun install)..." >&2
(cd "$REPO_ROOT" && bun install)

if [ ! -f "$WRAPPER" ]; then
  echo "error: shim not found at $WRAPPER" >&2
  exit 1
fi

# 2. Download Chrome for Testing (idempotent; agent-browser skips if present).
echo "Downloading Chrome for Testing (agent-browser install)..." >&2
if [ "$(uname -s)" = "Linux" ]; then
  echo "  (Linux: if launch fails for missing system libs, re-run with --with-deps)" >&2
fi
"$WRAPPER" install

# 3. Symlink the shim onto PATH (no sudo). Remove the retired browser-buddy
#    wrapper link from earlier versions if present.
mkdir -p "$BIN_DIR"
rm -f "$BIN_DIR/browser-buddy"
ln -sfn "$WRAPPER" "$LINK"
echo "Linked $LINK -> $WRAPPER" >&2

# 4. Warn if ~/.local/bin is not on PATH.
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo "" >&2
    echo "WARNING: $BIN_DIR is not on your PATH. Add this to your shell profile:" >&2
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\"" >&2
    echo "Until then, call agent-browser as $LINK" >&2
    echo "" >&2
    ;;
esac

# 5. Smoke test through the freshly linked binary, including the JPEG path.
echo "Running smoke test..." >&2
"$LINK" --session smoke open https://example.com \
  && "$LINK" --session smoke snapshot -i \
  && "$LINK" --session smoke --screenshot-format jpeg screenshot /tmp/ab-smoke.jpg \
  && "$LINK" --session smoke close

echo "" >&2
echo "Done. agent-browser is installed. Try: agent-browser --session demo open https://example.com" >&2
