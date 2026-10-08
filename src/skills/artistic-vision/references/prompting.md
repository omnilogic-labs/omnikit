# Prompting generate and edit

## Contents

- Scene descriptions and templates
- Text inside images
- Reference images
- Subject consistency
- Framing and composition
- Judging

## Scene descriptions and templates

Models are tuned for narrative description, not tag lists. `A photorealistic wide-angle shot of a vibrant coral reef teeming with tropical fish` beats `coral reef, fish, underwater`.

| Goal                   | Shape of the prompt                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Photoreal              | `A photorealistic [shot type] of [subject] in [setting]. [Lighting]. Shot from [angle] with a [lens].`                                    |
| Illustration / sticker | `A [style] of [subject with accessories/action]. The design features [bold outlines, cel-shading…] and [colour/background].`              |
| Text in an image       | `Create a [image type] for [brand] with the text "[exact text]" in a [font style]. The design should be [style], with a [colour scheme].` |
| Product mockup         | `A high-resolution, studio-lit product photograph of [product] on [surface]. The lighting is [setup] to [purpose].`                       |
| Negative space         | `A minimalist composition featuring a single [subject] in the [position]. The background is a vast, empty [colour] canvas…`               |

## Text inside images

Small type garbles plausibly: fine at thumbnail size, wrong when read.

- Describe the font by character ("clean bold sans-serif", "elegant serif"), never by name; font names are not honoured.
- Use `--model gemini-3-pro-image-preview` for real typography.
- Raise `--size` to `2K` or `4K`. There is no post-hoc fix, since `upscale` and `resize` add no detail.
- Give the exact string in quotes and constrain lists by count ("exactly eight ingredients, once each"); unconstrained lists sprout duplicates and inventions.
- Verify with `bin/art ocr <out> --plain` and diff against the spec. Do not trust a glance or `--judge` alone.

## Reference images

`--ref <path>` is repeatable on both commands. Images are sent in order, followed by the prompt. Say in the prompt what each image is for.

`generate --ref` has no primary image: references inform style, likeness and vocabulary while the prompt dictates composition. Use it for a sibling of the references.

```bash
bin/art generate /tmp/new-label.png "$(cat prompts/new-label.md)" \
  --ref art/label-a.png --ref art/label-b.png \
  --aspect 1:1 --size 2K
```

Prompt text such as "the attached images are house style references only; match the typography and the subject, not their colours or framing devices" keeps the references from over-constraining.

`edit` has a primary `<input>` that the model anchors on, so it reproduces that layout and palette even when told not to. Use `edit --ref` for structure from one image and style from another; the first image is the primary, then each `--ref`.

```bash
bin/art edit light/flow.png dark/flow.png \
  "Recreate the FIRST image exactly (identical layout and linework); re-theme to
   dark mode matching the colours of the SECOND image." \
  --ref primers/dark.png
```

## Subject consistency

Pass prior images as `--ref` and let the pixels carry the likeness. Do not also describe the subject in prose: words compete with the references and pull toward the generic. Say instead: "It must be the exact same dog: take his likeness directly from the attached images, not from any description. Only his accessories and setting change."

| Model                            | Object refs | Character refs | Style refs |
| -------------------------------- | ----------- | -------------- | ---------- |
| `gemini-3-pro-image-preview`     | 6           | 5              | none       |
| `gemini-3.1-flash-image-preview` | 10          | 4              | 3          |

## Framing and composition

State where the subject sits relative to the frame, or you get the default. "Filling the frame" yields a subject tangent to all four edges (a circle becomes a disc touching each edge midpoint). To get clearance, ask for it and verify by measuring pixels.

## Judging

`--attempts N --judge <criteria>` renders N candidates and scores each with the text model `gemini-3.8-flash`; image models cannot score, because they answer a JSON request with another image. A score is one model's opinion, so treat it as a hint. If judging fails, the run writes the best attempt it has and warns.
