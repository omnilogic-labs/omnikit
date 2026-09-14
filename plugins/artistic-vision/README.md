# Artistic Vision

AI image intelligence toolkit. Gemini-powered vision and generation (describe, generate, edit, ocr, detect, extract, diff, compare, analyze, batch) plus Sharp-powered local manipulation (info, resize, upscale, crop, palette, optimize, convert, sprite sheets).

CLI entry point: `skills/artistic-vision/bin/art`.

## Requirements

- `bun` on your PATH (https://bun.sh). Nothing else to set up.
- `GEMINI_API_KEY` in the environment for the Gemini-powered subcommands (`GOOGLE_API_KEY` is accepted as a legacy fallback). The Sharp-powered subcommands are local and need no key.

## Dependencies

`bin/art` bootstraps itself. On its first run it checks whether `sharp`, `commander`, and `@google/genai` resolve from any `node_modules` above the scripts; if they do not, it runs `bun install` scoped to this plugin directory once, reports that on stderr, and then runs the requested subcommand. Later runs are a handful of file checks and install nothing.

That matters for plugin installs: Claude Code copies this directory to `~/.claude/plugins/cache/<marketplace>/artistic-vision/<version>/`, which has no `node_modules` above it, so a `bun install` in a clone of the repo cannot satisfy the installed copy. Inside a clone of this repo the workspace install at the repo root already satisfies the dependencies, so the bootstrap stays out of the way and no duplicate dependency tree is created.
