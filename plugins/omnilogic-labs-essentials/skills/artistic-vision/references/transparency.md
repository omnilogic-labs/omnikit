# Transparent backgrounds

`generate` and `edit` cannot produce a true alpha channel. Asked for transparency, the model bakes a fake checkerboard into opaque pixels.

Two commands produce real alpha:

- `extract` asks the model to isolate the subject on a solid chroma color (`--key green` default, or `magenta` for green subjects), then keys that color out locally with a soft matte and despill. It warns if almost nothing keyed out (the model ignored the backdrop request); re-run or switch key color.
- `key` is the local half on its own (sharp, no API): chroma-key an image already on a solid green or magenta backdrop, such as a `generate` or `edit` result prompted onto neon green.

`extract` re-renders the subject through the image model, so expect a slight repaint and softer detail. To keep original pixels untouched, `crop` and mask locally, or `generate`/`edit` onto green and `key` it.

Pick a key color that does not occur in the subject. Verify the cut with `--inspect` or `bin/art info` (confirm an alpha channel exists).

## Options

`extract <input> <output>`:

- `--subject <description>`: what to keep (default "the main subject")
- `--key <color>`: `green` (default) or `magenta`
- `--inspect [question]`: auto-describe the result

`key <input> <output>` (local, no API):

- `--color <color>`: `green` (default) or `magenta`
- `--trim`: trim fully transparent borders
