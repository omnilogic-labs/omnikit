# Plan: compile-step follow-ups

**Goal:** Close the four follow-ups from the compile-step milestone review: agy model validation, a sensible
build OS default, the last stray dashes, and agy agents dispatched by name.

Repo rules (AGENTS.md): edit `src/` and `scripts/build/`, never generated output (`plugins/omnilogic-labs/skills`,
`plugins/omnilogic-labs/agents`, root `skills/`, `dist/`); regenerate with `bun run build`. Bun only. No em or en
dashes anywhere you write.

**Check command** (CHECK below):
`bun run check && bun run build:check && bun test scripts/build && bun run budget`

`bun run verify` needs the real HOME and a `dist/` built by `bash install.sh`, so it runs only on main after the
last merge (see Waves).

---

## Task agy-model-check

- **Goal:** The build fails with a clear error when an agy agent would get a `model:` other than `pro`, `flash`
  or `inherit`, whether it comes from the agy tier table or a per-agent `models: { agy: ... }` override.
- **Files:** `scripts/build/build.ts` (agents section only: `emitAgent`, `parseAgentMeta`), `scripts/build/hosts.ts`
  (may add an exported allowed-model list for agy, for example `AGY_MODELS`), new test file
  `scripts/build/agy-model.test.ts` (keep it out of `build.test.ts`, which build-os-default owns in wave 2).
- **Steps:**
  - Keep the allowed list next to the agy host entry in `hosts.ts` (a field such as `allowedModels?: string[]` on
    `Host`, set only for agy, is one option).
  - In `emitAgent`, after the model is resolved (`meta.models[host.name] ?? host.tier[meta.tier]`), push a
    `RenderError` when the host has an allowed list and the model is not on it. Name the file, the line of
    `models:` when an override caused it (else `tier:`), the bad value, and the allowed values, and say where to
    fix it (`scripts/build/hosts.ts` agy tier, or the agent's `models.agy`).
  - Errors already stop the build with exit 1 and "nothing written"; confirm that path, do not add a new one.
  - Tests: call `emitAgent` with `{ ...HOSTS.agy, tier: { deep: "gemini-ultra", fast: "flash" } }` and with an
    agent source whose `models: { agy: gemini-ultra }`; both push one error containing `gemini-ultra` and
    `pro, flash, inherit`, and emit no file. `pro`, `flash`, `inherit` (tier and override) pass. A CLI test builds
    a fixture copy with a bad `models.agy` into a temp out dir and expects exit 1 and the message on stderr.
    Codex and Claude overrides with arbitrary names still pass.
- **Tier:** fast
- **Depends on:** none
- **Acceptance criteria:**
  1. `bun test scripts/build/agy-model.test.ts` passes, with at least the cases listed in Steps (tier table bad,
     `models.agy` bad, each allowed value good, non-agy override unrestricted, CLI exit 1).
  2. Temporarily set `tier.deep` of agy in `scripts/build/hosts.ts` to `"gemini-ultra"`, run `bun run build`:
     exit code is 1, stderr names `gemini-ultra` and `pro, flash, inherit`, and `git status --short` shows no
     change under `plugins/` or `skills/`. Then `git checkout scripts/build/hosts.ts`.
  3. With the real `hosts.ts`, `bun run build` exits 0 and `git status --short plugins skills` is empty.
  4. CHECK exits 0.

## Task dash-cleanup

- **Goal:** No em or en dash remains in the repo outside `rewrites.md` (source and its two generated copies),
  `node_modules`, `dist` and `.git`, with behaviour unchanged.
- **Files:** `plugins/omnilogic-labs/bin/agent-browser`, `bench/browser-buddy/grade/report.mjs`,
  `scripts/skill-stats.sh`, plus any other hit the grep below finds (none others today).
- **Steps:**
  - `plugins/omnilogic-labs/bin/agent-browser` (hand-written, not generated): 7 lines, 6 comments and one `echo`
    message (line 226). Rewrite each with a colon, comma, parentheses or a new sentence.
  - `bench/browser-buddy/grade/report.mjs` lines 203 and 206: output strings; use `: ` or `, `.
  - `scripts/skill-stats.sh` line 32 `count_dashes` greps for the literal dash characters. Keep the behaviour but
    drop the literals, for example `grep -o -e "$(printf '\342\200\224')" -e "$(printf '\342\200\223')"` (portable
    to macOS grep, no `-P`). Confirm it still counts by running it on `src/skills/plain-writing/references/rewrites.md`
    before and after.
- **Tier:** fast
- **Depends on:** none
- **Acceptance criteria:**
  1. `grep -rlP "[\x{2013}\x{2014}]" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git .` prints
     exactly the three `references/rewrites.md` paths (src, plugin, root `skills/`).
  2. `git diff --stat main` touches only the files listed above (plus any extra the grep found).
  3. `bash -n plugins/omnilogic-labs/bin/agent-browser` and `bash -n scripts/skill-stats.sh` exit 0;
     `node --check bench/browser-buddy/grade/report.mjs` (or `bun build --no-bundle` on it) exits 0.
  4. `bash scripts/skill-stats.sh` output is byte-identical to its output on `main` (run both and `diff`).
  5. In a scratch shell, `source <(sed -n '/^count_dashes()/p' scripts/skill-stats.sh); count_dashes src/skills/plain-writing/references/rewrites.md`
     prints the same nonzero number as the `main` version.
  6. CHECK exits 0.

## Task agy-agents-by-name

- **Goal:** The coordinator tells agy to invoke the installed `planner`, `builder` and `verifier` agents by name
  with `invoke_subagent`, and to paste `roles/<role>.md` only when they are not installed; the invocation shape is
  confirmed against agy 1.3.1.
- **Files:** `src/skills/coordinator/references/hosts.md` (agy block), `src/skills/coordinator/SKILL.md` (agy
  block, lines 50 to 56), and the generated copies `bun run build` rewrites (root `skills/coordinator/**`; the
  Claude plugin tree drops agy blocks so should not change).
- **Steps:**
  - Confirm the shape first. Known so far: `agy agents < /dev/null` lists `browser-buddy`, `builder`, `planner`,
    `verifier` on this machine (from `~/.gemini/config/agents`). Ask agy for its own tool schema, for example
    `cd <scratch dir> && agy -p "Print the exact JSON parameter schema of your invoke_subagent tool. Do not call it." < /dev/null`,
    then run one real call such as `agy -p --dangerously-skip-permissions "Use invoke_subagent to run the planner agent by name with the task: reply OK" < /dev/null`
    (use `--print-timeout` to bound it). Record the parameter names that select the agent and carry the task,
    and whether a model or workspace parameter exists.
  - Rewrite the agy block of `hosts.md` to match the Codex block's shape: installed agents first (name, the
    parameters you confirmed, `agy agents` to check what is installed, model by tier `{{tier.deep}}` /
    `{{tier.fast}}`), then the fallback (read `roles/<role>.md`, pass its body as the start of the prompt). Keep the
    workspace-mode bullet.
  - Edit the agy block in `SKILL.md` to say the same in short. SKILL.md is at exactly 150 lines: the edit must not
    add a line.
  - Run `bun run build`. Put what you confirmed (agy version, commands run, parameter names, any surprise) in the
    commit message body.
- **Tier:** deep
- **Depends on:** none
- **Acceptance criteria:**
  1. `grep -n "invoke_subagent" dist/agy/skills/coordinator/references/hosts.md` matches inside the agy section,
     and that section names `planner`, `builder`, `verifier` and the confirmed parameter names, and still mentions
     `roles/<role>.md` as the fallback.
  2. The agy section of `dist/agy/skills/coordinator/SKILL.md` mentions dispatch by name and the paste fallback.
  3. `git diff --stat main -- plugins/omnilogic-labs` shows no change (the Claude tree has no agy blocks).
  4. `wc -l src/skills/coordinator/SKILL.md` prints at most 150.
  5. The commit message records the agy version (`agy --version` or `agy changelog`) and the confirmed
     `invoke_subagent` parameters.
  6. CHECK exits 0.

## Task build-os-default

- **Goal:** Plain `bun run build` writes `dist/<host>` for a real OS instead of `any`, so `install.sh --check` and
  `bun run verify` do not report `wrong-os` after it; committed trees stay any-OS and `--os` stays an explicit
  override.
- **Files:** `scripts/build/build.ts` (`parseArgs`, `main`, header comment; plus any small helper), `scripts/build/os.ts`
  (OS detection helper), `scripts/build/build.test.ts` (`--os` describe block), `AGENTS.md` (the `bun run build`
  line), `README.md` (line 80 note, and line 36 if it needs it).
- **Steps:**
  - Resolve the default in this order when `--os` is not given: `OMNIKIT_OS` env (same override install.sh honours,
    validated the same way), then a concrete OS (not `any`) recorded in `<out>/dist/codex/.os` or
    `<out>/dist/agy/.os` when they agree, then detection.
  - Detection mirrors `install.sh` `detect_os` (lines 123 to 135): `uname -s`/`process.platform` Darwin is macos,
    Windows (`win32`, or MINGW/MSYS/CYGWIN) is windows, Linux with `microsoft` in `/proc/version` is wsl, else
    linux. Export it from `os.ts` taking injectable inputs (platform string, `/proc/version` text) so tests do not
    depend on the host.
  - `--os any` still works explicitly. `--check` is unaffected (it compares committed trees only).
  - Print the chosen OS and where it came from in the final status line (`dist OS: wsl (detected)`).
  - `install.sh` keeps passing `--os "$OS"` explicitly; do not change it.
  - Docs: AGENTS.md line 9 and README line 80 say the default now follows `.os` or detection, `--os` overrides,
    and committed trees are always any-OS.
  - Tests: detection table (darwin, win32, linux with and without microsoft); default reuses a recorded `windows`
    in a temp out dir; recorded `any` or missing `.os` falls through to detection; `OMNIKIT_OS` wins over `.os`;
    explicit `--os` wins over both; Claude tree and root `skills/` stay any-OS in every case.
- **Tier:** deep
- **Depends on:** agy-model-check (both edit `scripts/build/build.ts`; run after it merges)
- **Acceptance criteria:**
  1. `bun test scripts/build` passes and includes the cases listed in Steps.
  2. `rm -rf dist && bun run build && cat dist/codex/.os dist/agy/.os`: both print `wsl` on this WSL machine (the
     detected OS), and stderr names the source.
  3. `echo windows > dist/agy/.os; echo windows > dist/codex/.os; bun run build && cat dist/agy/.os` prints
     `windows`; then `bun run build -- --os linux && cat dist/agy/.os` prints `linux`; then
     `OMNIKIT_OS=wsl bun run build && cat dist/agy/.os` prints `wsl`.
  4. After criterion 3, `git status --short plugins skills` is empty (committed trees unchanged).
  5. `grep -n "bun run build" AGENTS.md` and README line around "wrong-os" describe the new default and no longer
     say it writes OS `any`.
  6. CHECK exits 0.

---

## Waves

1. **Wave 1:** agy-model-check, dash-cleanup, agy-agents-by-name (disjoint files: agy-model-check owns the agents
   section of `build.ts`, `hosts.ts` and a new test file; the other two touch no build script).
2. **Wave 2:** build-os-default (also edits `build.ts` and owns `build.test.ts`, `os.ts`, `AGENTS.md`, `README.md`).
3. **After the last merge, on main:** `bash install.sh` then `bun run verify` (real HOME); then plain
   `bun run build` followed by `bash install.sh --check` reports no `wrong-os`.

## Risks

- agy invocation shape: `agy -p` hangs without `< /dev/null`; a real `invoke_subagent` call needs approval, so
  use `--dangerously-skip-permissions` in a scratch directory and `--print-timeout`. If agy cannot run a subagent
  from print mode, record that, and base the doc on the schema agy reports; the owner may want to confirm in an
  interactive session.
- Whether agy's `invoke_subagent` accepts a model per call is unknown; if not, the tier line should say the model
  comes from the agent file (set by the build), not the call.
- `src/skills/coordinator/SKILL.md` is at the 150-line budget; agy-agents-by-name must reword in place.
- dash-cleanup changes two output strings in `report.mjs` and one `echo` in `bin/agent-browser`. Only the dash
  changes; if any bench grader or test matches those strings literally, update it in the same task.
- build-os-default: tests that call `build()` directly with no OS must not start depending on the test host; pass
  an explicit OS or inject detection inputs.
