---
name: artistic-vision
description: |
  General-purpose AI image intelligence toolkit. Gemini-powered AI operations
  (describe, generate, edit, compare, analyze, ocr, detect, extract, diff) plus
  sharp-powered local manipulation (info, resize, upscale, crop, palette,
  optimize, convert, sprite sheets). Use for any image task: understanding
  contents, creating or editing images, extracting text, detecting objects,
  removing backgrounds, optimizing for web, batch processing, and more.
metadata:
  author: mike
  version: "3.0"
  keywords: image, generation, editing, ocr, detection, optimization, sprites, pixel-art, gemini, sharp
---

# Artistic Vision

General-purpose AI image intelligence toolkit.

## CLI

```bash
bin/art <subcommand> [args] [options]
```

`bin/art` lives at the root of this skill directory; call it by that path (or an absolute path to it). Just run the command you need. Do not preflight: the binary checks its own prerequisites and exits with a clear message (e.g. `Missing required environment variable: GEMINI_API_KEY`) when something is missing. Do not `echo $GEMINI_API_KEY`, `command -v art`, or `ls bin/` first.

`bun` must be on PATH; nothing else needs setting up. On its very first run from a fresh install the binary installs its own runtime dependencies (`sharp`, `commander`, `@google/genai`) next to its `package.json`, prints that progress to stderr, and then does the work you asked for. That costs a second or two once. Every later run is a few file checks and installs nothing, so never run `bun install` by hand as a preparation step.

Gemini-powered subcommands need `GEMINI_API_KEY` in the environment (`GOOGLE_API_KEY` is accepted as a legacy fallback); the binary enforces this itself, only when the call actually needs it. Sharp-powered subcommands run locally and need no API key, so never gate them behind a key check.

## Gemini-powered Subcommands (API calls)

| Subcommand                               | Usage                     | What it does                                     |
| ---------------------------------------- | ------------------------- | ------------------------------------------------ |
| `describe <image> [question]`            | Understand image contents | Ask about or describe an image                   |
| `generate <output> <prompt...>`          | Create new images         | Generate image from text prompt                  |
| `edit <input> <output> <instruction...>` | Modify existing images    | Edit image with natural language                 |
| `compare <img1> <img2> [question]`       | Free-text comparison      | Compare two images side by side                  |
| `analyze <image>`                        | Structured analysis       | Local metadata + AI analysis as JSON             |
| `ocr <image>`                            | Extract text              | OCR for screenshots, docs, diagrams, handwriting |
| `detect <image>`                         | Find objects              | Object detection with bounding boxes             |
| `extract <input> <output>`               | Remove background         | AI-guided subject extraction                     |
| `diff <img1> <img2>`                     | Structured diff           | Semantic diff with categorized changes           |
| `batch <subcommand> <glob>`              | Bulk operations           | Run any subcommand across many files             |

### Common Options (Gemini subcommands)

- `--model <model>`: override the default Gemini model
- `--json`: output structured JSON (log messages go to stderr)

### `generate` and `edit` Extra Options

- `--inspect [question]`: auto-describe the result after generation or editing
- `--attempts <n>`: generate N times and keep the best (requires `--judge`)
- `--judge <criteria>`: AI judging criteria for multi-attempt mode
- `--ref <path>`: reference image, repeatable (see the two sections below)
- `--aspect <ratio>`: `1:1` `2:3` `3:2` `3:4` `4:3` `4:5` `5:4` `9:16` `16:9` `21:9`
- `--size <size>`: `512`, `1K`, `2K`, `4K` (default `1K`; uppercase `K`). Note `0.5K` is
  documented but rejected by the API — use `512`.

`--aspect`/`--size` are the only way to control output dimensions — the local
`upscale`/`resize` tools resample, they do not add detail. Reach for `2K`/`4K`
when the image contains **small type**, which is where these models fail first.
Both flags validate against the lists above and exit on a typo rather than
silently falling back to a 1K square.

### `generate` Reference Images (`--ref`)

`generate` takes any number of reference images via a repeatable `--ref <path>`,
sent in order and followed by the prompt.

The difference from `edit` matters. `edit` has a **primary input** that the model
anchors on, so it tends to reproduce that image's layout and palette even when
told not to. `generate --ref` has no primary — the references inform style,
likeness, and vocabulary while the prompt alone dictates the composition. Use it
when you want a **sibling** of the references rather than a variant of one.

```bash
# A new label in an existing brand family: same illustrated subject and
# typography, but its own palette and layout — which an `edit` of either
# reference actively resists.
bin/art generate /tmp/new-label.png "$(cat prompts/new-label.md)" \
  --ref art/label-a.png --ref art/label-b.png \
  --aspect 1:1 --size 2K
```

Say in the prompt what the references are for ("the attached images are house
style references only — match the typography and the subject, not their colours
or framing devices").

### `edit` Multiple Reference Images (`--ref`)

`edit` takes one **primary** input (the `<input>` argument) plus any number of
additional **reference** images via a repeatable `--ref <path>`. All images are
sent to the model in order — primary first, then each `--ref` — followed by the
instruction. Say what each image is for in the instruction ("the first image is
the layout, the second is the colour style").

This is the reliable way to do **structure-from-one, style-from-another**: keep an
asset's exact composition while re-skinning it to match a style reference.

```bash
# Re-theme a light diagram to dark, matching a dark style primer, keeping layout:
bin/art edit light/flow.png dark/flow.png \
  "Recreate the FIRST image exactly (identical layout and linework); re-theme to
   dark mode matching the colours of the SECOND image." \
  --ref primers/dark.png
```

## Writing Prompts That Work

Distilled from Google's image-generation guide plus mistakes made in real use.
Read this before writing a prompt; it will save you several wasted generations.

### Describe a scene, do not list keywords

The single biggest lever. These models are tuned for narrative description, not
tag soup. `A photorealistic wide-angle shot of a vibrant coral reef teeming with
tropical fish` beats `coral reef, fish, underwater`.

Templates from the official guide, worth following literally:

| Goal                   | Shape of the prompt                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Photoreal              | `A photorealistic [shot type] of [subject] in [setting]. [Lighting]. Shot from [angle] with a [lens].`                                    |
| Illustration / sticker | `A [style] of [subject with accessories/action]. The design features [bold outlines, cel-shading…] and [colour/background].`              |
| Text in an image       | `Create a [image type] for [brand] with the text "[exact text]" in a [font style]. The design should be [style], with a [colour scheme].` |
| Product mockup         | `A high-resolution, studio-lit product photograph of [product] on [surface]. The lighting is [setup] to [purpose].`                       |
| Negative space         | `A minimalist composition featuring a single [subject] in the [position]. The background is a vast, empty [colour] canvas…`               |

### Text inside images is the #1 failure mode

Small type garbles, and it garbles _plausibly_ — it looks fine at thumbnail size
and is wrong when you read it.

- Describe the font **characteristically** ("clean bold sans-serif", "elegant
  serif"), never by name. Font names are not honoured.
- Use `--model gemini-3-pro-image-preview` for anything with real typography.
- Raise `--size` to `2K` or `4K`. Small text needs pixels, and there is no
  post-hoc fix: `upscale`/`resize` resample without adding detail.
- Give the exact string in quotes, and constrain any list by count ("exactly
  eight ingredients, once each"). Unconstrained lists sprout duplicates and
  inventions.
- **Always verify with `bin/art ocr <out> --plain`** and diff against the spec.
  Do not trust a glance at the image, and do not trust `--judge` alone.

### Subject consistency across images

Pass prior images as `--ref` and let the pixels carry the likeness. Do **not**
also write a prose description of the subject: your words compete with the
references and pull the result toward the generic — a described dog becomes a
stock labrador. Say this instead:

> It must be the exact same dog: take his likeness directly from the attached
> images, not from any description. Only his accessories and setting change.

Per-model reference caps:

| Model                            | Object refs | Character refs | Style refs |
| -------------------------------- | ----------- | -------------- | ---------- |
| `gemini-3-pro-image-preview`     | 6           | 5              | —          |
| `gemini-3.1-flash-image-preview` | 10          | 4              | 3          |

### Framing and composition

Say where the subject sits **relative to the frame**, or you get the model's
default. "Filling the frame" yields a subject tangent to all four edges — for a
circle, an inscribed disc touching each edge midpoint. That is usually right for
a die-cut asset, but if you need clearance you must ask for it, and then verify
by measuring pixels rather than by eye.

### `--judge` is a hint, not a gate

`--attempts N --judge` scores using the image model to emit structured JSON,
which intermittently returns nothing parseable and **aborts the whole run**,
discarding the attempts it already paid for. For anything that matters, generate
N candidates in a shell loop and evaluate them yourself.

### Transparent Backgrounds: Not Supported Directly

`generate` and `edit` **cannot** produce images with a true transparent (alpha) background. When asked for transparency, the model typically renders a fake checkerboard pattern (the visual placeholder editors like Photoshop use to _represent_ transparency), baked in as opaque pixels. The result looks transparent but is not.

Two commands produce true alpha:

- `extract` does the whole dance in one call: it asks the model to isolate the
  subject on a solid chroma color (`--key green` default, or `magenta` for
  green subjects), then keys that color out **locally** into a real alpha
  channel (soft matte + despill). It warns if almost nothing keyed out (the
  model ignored the backdrop request); re-run or switch key color.
- `key` is the local half on its own (sharp, no API): chroma-key an image you
  already have on a solid green/magenta backdrop — e.g. a `generate`/`edit`
  result you prompted onto neon green — to true transparency.

Note `extract` re-renders the subject through the image model, so expect a
slight repaint (softer detail than the source pixels). When you need the
original pixels untouched, `crop` + mask locally, or `generate`/`edit` onto
green and `key` it.

Pick a key color that does not occur in the subject, and verify the cut with `--inspect` or `bin/art info` (confirm an alpha channel exists).

### `extract` Options

- `--subject <description>`: what to keep (default: "the main subject")
- `--key <color>`: chroma key color, `green` (default) or `magenta` — use magenta for green subjects
- `--inspect [question]`: auto-describe the result

### `key` Options (local, no API)

`key <input> <output>` chroma-keys a solid green/magenta backdrop to real transparency.

- `--color <color>`: `green` (default) or `magenta`
- `--trim`: trim fully transparent borders from the result

### `detect` Options

- `--what <description>`: what to detect (default: all prominent objects)
- `--draw <output>`: render bounding boxes on the image

### `ocr` Options

- `--plain`: output plain text only (no JSON structure)

### `analyze` Options

- `--local-only`: skip AI analysis, only show local sharp metadata

## Sharp-powered Subcommands (local, no API, instant)

| Subcommand                   | Usage              | What it does                                                                                 |
| ---------------------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `info <image>`               | Check properties   | Dimensions, format, channels, file size                                                      |
| `resize <in> <out> <dims>`   | Resize images      | WxH, W, xH, or N%; lone W/H keeps aspect; EXIF-upright; use `--kernel nearest` for pixel art |
| `upscale <in> <out> <scale>` | Integer upscale    | Nearest-neighbor (2x, 3x, 4x, 8x) for pixel art or icons                                     |
| `crop <in> <out> <x,y,w,h>`  | Extract regions    | Crop to specific coordinates                                                                 |
| `palette <image>`            | Color palette      | Extract colors as hex values with frequency                                                  |
| `optimize <in> <out>`        | Web optimization   | Smart format, quality, size detection                                                        |
| `convert <in> <out>`         | Change format      | PNG, JPEG, WebP, AVIF (from extension)                                                       |
| `sheet split <img>`          | Split sprite sheet | Extract individual frames                                                                    |
| `sheet assemble <dir>`       | Build sprite sheet | Combine frames into sheet                                                                    |
| `sheet analyze <img>`        | Analyze sheet (AI) | Frame detection, animation type, consistency                                                 |

### `optimize` Options

- `--format <fmt>`: force output format (auto-detected if omitted)
- `--quality <n>`: quality 1-100 (default: auto)
- `--max-width <n>`: maximum width in pixels
- `--target-size <kb>`: target file size budget in KB

### `palette` Options

- `--limit <n>`: max colors to show (default: 16)
- `--json`: output as JSON

## Model Selection

- **Default: Flash** (`gemini-3.1-flash-image-preview`): fast, near-Pro quality, used for all operations.
- **Pro** (`gemini-3-pro-image-preview`): highest fidelity, only when the user explicitly requests high quality.
- Pass `--model gemini-3-pro-image-preview` explicitly for maximum quality.

## Examples

```bash
# Describe an image
bin/art describe screenshot.png "What UI components are visible?"

# Generate with auto-inspection
bin/art generate /tmp/logo.png a minimalist logo for a coffee shop --inspect

# Generate with quality judging (3 attempts, keep best)
bin/art generate /tmp/icon.png a flat design app icon --attempts 3 --judge "clean, professional, consistent style"

# Edit an image
bin/art edit photo.jpg /tmp/edited.jpg make it look like a watercolor painting

# Extract subject (remove background)
bin/art extract photo.jpg /tmp/subject.png --subject "the person"

# OCR a screenshot
bin/art ocr screenshot.png --plain

# Detect objects with drawn boxes
bin/art detect photo.jpg --what "all text labels" --draw /tmp/annotated.jpg

# Structured image analysis
bin/art analyze product-photo.jpg --json

# Semantic diff of two versions
bin/art diff v1.png v2.png --json

# Extract color palette
bin/art palette design.png --json

# Optimize for web
bin/art optimize hero.jpg /tmp/hero.webp --max-width 1920 --target-size 200

# Upscale pixel art 4x
bin/art upscale icon-16.png icon-64.png 4

# Batch describe all PNGs
bin/art batch describe "sprites/*.png"

# Batch info on all images
bin/art batch info "assets/**/*.{png,jpg}" --json

# Sprite sheet operations
bin/art sheet split spritesheet.png --frame 32x32 --out frames/
bin/art sheet assemble frames/ --out sheet.png --cols 8
bin/art sheet analyze spritesheet.png --frame 32x32 --json
```

## Tips

- Use `--inspect` on `generate`, `edit`, or `extract` to auto-verify results.
- Need a transparent background? `generate` cannot make one (it fakes a checkerboard). Generate on a neon-green/magenta background, then `extract` to get real alpha. See "Transparent Backgrounds" above.
- Use `--json` when piping output to other tools.
- `info` and `palette` are free (no API), so use them liberally.
- For pixel art, always use `upscale` instead of `resize` (nearest-neighbor by default).
- `optimize` auto-detects the best format; use `--target-size` for bandwidth budgets.
- `batch` supports `describe`, `palette`, and `info` today; more subcommands coming.
