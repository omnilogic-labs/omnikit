# Omnilogic Labs Essentials

A small kit for people who are not developers: how the agent writes, images, and a real browser.

`skills/`, `agents/` and `bin/` here are generated from `src/` by `bun run build` (the kit table is `scripts/build/kits.ts`). Do not edit them; edit `src/` and rebuild.

## Skills

- `plain-writing`: write prose a reader understands on the first pass.
- `artistic-vision`: Gemini image generation and editing, Sharp local processing. Needs `GEMINI_API_KEY`.
- `agent-browser`: drive the agent-browser CLI. Expects `agent-browser` and Chrome to be installed on the machine already.

## Agents and binaries

- `browser-buddy`: a browser operator that does multi-step browsing and returns a short report.
- `bin/agent-browser`: the same wrapper as the whole plugin's, which finds the CLI in the repo's root `node_modules`.

Install it with `bash install.sh --kit essentials`.
