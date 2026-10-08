# Artistic Vision

Understands, generates, edits and processes images using Gemini and local sharp tools.

## Running

```bash
bin/art <subcommand> [args] [options]
```

`bin/art` is at the root of this skill directory; call it by that path. Run the command you need without preflight checks: the binary verifies its own prerequisites and exits with a clear message when something is missing.

- `bun` must be on PATH. On the first run the binary installs its own dependencies (`sharp`, `commander`, `@google/genai`) once, with progress on stderr. Never run `bun install` by hand.
- Gemini subcommands need `GEMINI_API_KEY` (`GOOGLE_API_KEY` is a legacy fallback), checked only when a call needs it.
- Sharp subcommands run locally and need no key. Never gate them behind a key check.
- `--json` gives structured output; log messages go to stderr.
- Windows: `bin/art` is a bash script. Run it from Git Bash, or from PowerShell as `& "$env:ProgramFiles\Git\bin\bash.exe" <skill dir>/bin/art ...`. Never run it bare from PowerShell or cmd: Windows opens an "Open with" dialog and the call hangs. Plain `bash` in PowerShell is often WSL. Without Git Bash, see `references/windows-powershell.md`.

## Subcommands

Gemini-powered (API calls):

| Subcommand                               | What it does                                     |
| ---------------------------------------- | ------------------------------------------------ |
| `describe <image> [question]`            | Describe or answer questions about an image      |
| `generate <output> <prompt...>`          | Generate an image from a text prompt             |
| `edit <input> <output> <instruction...>` | Edit an image with natural language              |
| `compare <img1> <img2> [question]`       | Free-text comparison of two images               |
| `analyze <image>`                        | Local metadata plus AI analysis as JSON          |
| `ocr <image>`                            | Extract text from screenshots, docs, handwriting |
| `detect <image>`                         | Object detection with bounding boxes             |
| `extract <input> <output>`               | Remove background to true alpha                  |
| `diff <img1> <img2>`                     | Semantic diff with categorized changes           |
| `batch <subcommand> <glob>`              | Run `describe`, `palette` or `info` over files   |

Sharp-powered (local, no API, instant):

| Subcommand                   | What it does                                |
| ---------------------------- | ------------------------------------------- |
| `info <image>`               | Dimensions, format, channels, file size     |
| `resize <in> <out> <dims>`   | WxH, W, xH or N%; lone W/H keeps aspect     |
| `upscale <in> <out> <scale>` | Nearest-neighbor 2x, 3x, 4x, 8x             |
| `crop <in> <out> <x,y,w,h>`  | Crop to coordinates                         |
| `palette <image>`            | Hex colors with frequency                   |
| `optimize <in> <out>`        | Smart format, quality and size              |
| `convert <in> <out>`         | PNG, JPEG, WebP, AVIF (from extension)      |
| `key <in> <out>`             | Chroma-key green or magenta to real alpha   |
| `sheet split\|assemble`      | Split or build sprite sheets                |
| `sheet analyze <img>`        | Frame detection and animation type (Gemini) |

Every option, flag and example is in [references/commands.md](references/commands.md).

## Choosing a model

- Default is `gemini-3.1-flash-image-preview` (Flash): fast, near-Pro quality, used for all image operations.
- `gemini-3-pro-image-preview` (Pro): highest fidelity. Use it when the user asks for high quality, and for any image with real typography. Pass it with `--model`.
- Commands that answer in JSON (`--judge`, `ocr`, `detect`, `analyze`, `diff`, `sheet`) run on the text model `gemini-3.8-flash`. An image model passed to them is redirected to it, because image models ignore a response schema and return an image.

## Generating and editing

- Output size is set only by `--aspect` and `--size`; `resize` and `upscale` resample without adding detail.
- Write prompts as narrative scene descriptions, not keyword lists.
- Pass references with repeatable `--ref <path>`. `generate --ref` makes a sibling of the references; `edit` keeps its primary input's layout.
- Add `--inspect` to `generate`, `edit` or `extract` to verify the result.
- `--attempts <n> --judge <criteria>` renders n candidates and keeps the best by the text model's score. Treat the score as a hint. If judging fails, the best attempt is still written and a warning is printed.
- Text inside images is the most common failure. Use Pro and `--size 2K` or `4K`, quote the exact string, and always verify with `bin/art ocr <out> --plain`.
- `generate` and `edit` cannot make a transparent background. Use `extract`, or prompt onto solid green and run `key`.

Details: [references/prompting.md](references/prompting.md) for prompts, text, consistency, framing, references and `--judge`; [references/transparency.md](references/transparency.md) for alpha.

## Tips

- `info` and `palette` are free; use them liberally to check results.
- For pixel art use `upscale` (nearest-neighbor), not `resize`; if resizing, pass `--kernel nearest`.
- Use `optimize --target-size <kb>` for bandwidth budgets; the format is auto-detected.
