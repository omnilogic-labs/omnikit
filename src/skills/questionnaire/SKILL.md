---
name: questionnaire
description: Build a decision questionnaire page from JSON: per-question background, what happened, images, options with consequences, and an "I don't know" default, plus a paste-back answer block. Use whenever the owner must decide something, instead of asking in chat.
---

# questionnaire

Turns a JSON spec into one self-contained page the owner answers in a browser. Each question carries its full
context. The page builds a plain-text answer block as the owner answers, and the owner pastes that block back into
the chat. Copying always works: a copy button, a fallback that selects the text, a Select all button, and a
plain-text view for phones.

## When to use it

- Any time the owner must make a decision you cannot make from the request, the code, or a sensible default.
- Two or more decisions at once, or one decision that needs pictures, history, or trade-offs to judge.
- Not for a yes/no the owner can answer from one sentence of context. Ask that in chat.

Never ask a decision as a terse chat line ("A or B?"). Give each question its whole context: why it comes up, what
happened, what each option costs, and what you will do if the owner does not know.

## Steps

1. Write the spec as JSON in a scratch directory (the shape is below).
   Put image files next to it, or give paths relative to the spec file.
2. Build the page. `bin/questionnaire` is at the root of this skill directory:

   ```bash
   bin/questionnaire <spec.json> <out dir>
   ```

   It needs `bun` or `node`. It checks the spec, copies each image into `<out dir>/images/`, writes
   `<out dir>/index.html`, and prints `{ "page": ..., "files": { "images/01-x.png": "<path>" } }`. On a bad spec
   it exits 1 and lists every problem; fix them and run it again.
   Windows: it is a bash script. Run it from Git Bash, or from PowerShell as
   `& "$env:ProgramFiles\Git\bin\bash.exe" <skill dir>/bin/questionnaire ...`, never bare.

Then show the page to the owner:

<!-- @if claude -->

- Publish it with the Artifact tool: `file_path` is the printed `page`, and `files` is the printed `files` map,
  passed as is. Pass `icon: "checklist"` and a one-sentence `description`. The out dir must be under the working
  directory or the scratchpad. The page already meets the artifact page contract, so do not edit it.
- Give the owner the link. To revise the questions, edit the spec, rebuild into the same out dir, and publish the
  same path again.

<!-- @endif -->
<!-- @if codex,agy -->

- Give the owner the printed `page` path to open in a browser. The images sit beside it in `images/`, so keep the
  out dir together.

<!-- @endif -->

Say what you need back: "Answer what you can, then press Copy answers and paste the block here."

## When the answers come back

Act on each answer. For `I don't know`, apply the default the question stated. Read every `Note:` line: a note can
change how you carry out an answer. Unanswered questions are listed at the top. Ask again only about those, and only
if they block you.

## Spec shape

```json
{
  "title": "Rover art pass decisions",
  "intro": "Markdown shown above the questions.",
  "questions": [
    {
      "id": "style",
      "title": "Which look should the rover models use?",
      "tag": "Art direction",
      "blocking": true,
      "background": "Why this question exists. Markdown.",
      "what_happened": "What you tried or saw. Markdown.",
      "images": [{ "path": "render.png", "caption": "Pass 1 render" }],
      "options": [
        { "label": "Low poly", "value": "lowpoly", "description": "What it costs and what follows." },
        { "label": "Smooth PBR", "value": "pbr", "description": "..." }
      ],
      "multi": false,
      "idk": "What you will do if the owner picks I don't know."
    }
  ]
}
```

Required: `title`, and per question `id` (unique), `title`, `options` (each with `label`), and `idk`. Everything
else is optional. `value` defaults to `label`. `multi: true` makes the options checkboxes. Every question gets an
optional note box and an "I don't know" choice. Markdown means paragraphs, `-` and `1.` lists, `**bold**`,
`*italic*`, `` `code` ``, and `[links](https://...)`; HTML in the spec shows as text.

## Writing good questions

- One decision per question. Split "which engine and which platforms" into two.
- `background`: why this is a decision now, and what it affects. Assume the owner has not read the session.
- `what_happened`: the facts you have, including what failed. Show pictures of anything visual. You must have
  looked at each image yourself.
- Each option's `description` states its consequence: time, cost, risk, and what it rules out.
- `idk` is a real plan you will carry out, never "we'll ask again".
- Mark `blocking: true` only when work stops until it is answered.
- Use short, stable `id`s (`style`, `targets`); the answer block names questions by id.

## Answer block

```text
Answers: Rover art pass decisions
(2 of 3 answered; unanswered: names)

style. Which look should the rover models use? [blocking]
  Answer: Smooth PBR [pbr]
  Note: Match the concept art.

targets. Which platforms must the first build run on?
  Answer: I don't know. Default applies: We ship Windows only and add the others when asked.

names. Should the parts keep their placeholder names?
  Answer: (no answer yet)
```

A multi-select answer lists its choices in spec order, separated by `; `. The `[value]` follows the label when the
two differ.

## Notes

- Images must be local files (png, jpg, gif, webp, svg, avif) or `data:` URIs. Download remote images first:
  artifact pages cannot load other sites.
- Answers persist in the viewer's browser storage, so a reload keeps them. Nothing reaches you until the owner
  pastes the block.
- The example spec in `examples/sample.json` builds a working page; copy it as a starting point.
