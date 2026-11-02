# Windows PowerShell

If the Bash launcher cannot find Bun on Windows, invoke the TypeScript entrypoint
with Bun's Windows executable. Set `$skillDir` to this skill's directory in the
source checkout or installed plugin cache, without pinning a cache version:

```powershell
$skillDir = 'C:\path\to\artistic-vision'
$bun = Join-Path $env:USERPROFILE '.bun\bin\bun.exe'
& $bun (Join-Path $skillDir 'scripts\index.ts') info .\image.png
```

## Dependencies

This direct route bypasses the Bash launcher's first-run dependency install. Bun
resolves modules by walking up from `scripts\index.ts`, so the dependencies
(`sharp`, `commander`, `@google/genai`) must be present in a `node_modules`
somewhere above it:

- In a source checkout, run `& $bun install` once at the repo root. The root
  `bunfig.toml` hoists every workspace dependency into the root `node_modules`.
- In an installed plugin cache copy, no root workspace exists. The launcher
  installs into the nearest ancestor holding the skill's `package.json`, which
  is `$skillDir` itself, so run `& $bun install --cwd $skillDir` once.

## Gemini API key

For Gemini commands, use an existing `GEMINI_API_KEY` environment variable. If
Claude Code stores it in the user settings instead, load it in the same
PowerShell invocation as the command. Never display the settings file or the key:

```powershell
$settings = Join-Path $env:USERPROFILE '.claude\settings.json'
$env:GEMINI_API_KEY = (Get-Content -Raw -LiteralPath $settings | ConvertFrom-Json).env.GEMINI_API_KEY
& $bun (Join-Path $skillDir 'scripts\index.ts') describe .\image.png 'What is visible?'
```

Local commands such as `info`, `palette`, and `optimize` do not need this key.
