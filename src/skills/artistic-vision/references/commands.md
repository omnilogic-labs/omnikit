# Command reference

## Contents

- Gemini options
- generate and edit options
- Per-command options
- Local command options
- Examples

## Gemini options

- `--model <model>`: override the model on the commands that only read images (`describe`, `compare`, `ocr`, `detect`, `analyze`, `diff`, `sheet analyze`). `generate`, `edit` and `extract` always use Nano Banana 2.1.
- `--json`: structured JSON output (log messages go to stderr)

## generate and edit options

- `--inspect [question]`: auto-describe the result
- `--attempts <n>`: generate n times and keep the best (requires `--judge`)
- `--judge <criteria>`: judging criteria for multi-attempt mode
- `--ref <path>`: reference image, repeatable
- `--aspect <ratio>`: `1:1` `1:4` `1:8` `4:1` `8:1` `2:3` `3:2` `3:4` `4:3` `4:5` `5:4` `9:16` `16:9` `21:9`
- `--size <size>`: `1K`, `2K`, `4K` (default `1K`, uppercase `K`). Nano Banana 2.1 rejects `512`.

`--aspect` and `--size` are the only way to control output dimensions, and both exit on a typo rather than falling back to a 1K square. Use `2K` or `4K` when the image has small type.

## Per-command options

- `extract`: `--subject`, `--key`, `--inspect` (see [transparency.md](transparency.md))
- `key`: `--color`, `--trim` (see [transparency.md](transparency.md))
- `detect`: `--what <description>` (default all prominent objects), `--draw <output>` renders bounding boxes
- `ocr`: `--plain` outputs plain text only
- `analyze`: `--local-only` skips AI analysis and shows sharp metadata
- `batch`: supports `describe`, `palette` and `info`

## Local command options

- `resize`: `--kernel nearest` for pixel art; output is EXIF-upright
- `optimize`: `--format <fmt>` force format; `--quality <n>` 1-100 (default auto); `--max-width <n>`; `--target-size <kb>`
- `palette`: `--limit <n>` max colors (default 16); `--json`
- `sheet split <img> --frame WxH --out dir/`; `sheet assemble <dir> --out sheet.png --cols N`; `sheet analyze <img> --frame WxH --json`

## Examples

```bash
bin/art describe screenshot.png "What UI components are visible?"
bin/art generate /tmp/logo.png a minimalist logo for a coffee shop --inspect
bin/art generate /tmp/icon.png a flat design app icon --attempts 3 --judge "clean, professional, consistent style"
bin/art edit photo.jpg /tmp/edited.jpg make it look like a watercolor painting
bin/art extract photo.jpg /tmp/subject.png --subject "the person"
bin/art ocr screenshot.png --plain
bin/art detect photo.jpg --what "all text labels" --draw /tmp/annotated.jpg
bin/art analyze product-photo.jpg --json
bin/art diff v1.png v2.png --json
bin/art palette design.png --json
bin/art optimize hero.jpg /tmp/hero.webp --max-width 1920 --target-size 200
bin/art upscale icon-16.png icon-64.png 4
bin/art batch describe "sprites/*.png"
bin/art batch info "assets/**/*.{png,jpg}" --json
bin/art sheet split spritesheet.png --frame 32x32 --out frames/
bin/art sheet assemble frames/ --out sheet.png --cols 8
bin/art sheet analyze spritesheet.png --frame 32x32 --json
```
