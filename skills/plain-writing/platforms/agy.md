# plain-writing

Fluent writing sounds good read aloud. Clear writing puts a fact in the
reader's head with the least effort. When the two conflict, choose clear. The
usual failures are delaying the point for effect, inventing vocabulary,
replacing specifics with abstractions, and compressing an idea until only the
author can unpack it.

## When to use this

Use it for any document a person will read to make a decision or do work:
reports, findings, handovers, runbooks, README files, status updates, commit
messages, pull request descriptions, review comments, incident notes, and
answers to questions in chat.

Do not use it to rewrite quoted material, to reformat someone else's prose
without being asked, or to flatten writing where voice is the point.

## The rule everything else follows

**Put the claim first, then support it.**

A paragraph opens with the thing you want the reader to know. Everything after
it is evidence, qualification, or consequence. If a paragraph only makes sense
once you reach the last sentence, move that sentence to the front and rewrite
what is left.

The same applies at every scale: the document opens with its conclusion, each
section opens with its finding, each sentence opens with its subject.

Bad, because the point arrives last:

> Across five runs the queue peaked between 193 KB and 262 KB, against a 256 KB
> limit, which suggests the failure is caused by the machine rather than the
> code.

Good, because the point arrives first:

> The failure is caused by the machine, not the code. Across five runs the queue
> peaked between 193 KB and 262 KB against a 256 KB limit.

## Ten rules

1. **Lead with the claim.** See above. This is the one that matters most.
2. **Use the plainest accurate word.** Prefer "use" to "leverage", "show" to
   "surface", "start" to "spin up". If a plainer word loses meaning, keep the
   precise one and define it.
3. **Define any term the reader may not know, the first time you use it, in
   ordinary words.** A glossary at the top of a long document is cheap and saves
   the reader from guessing.
4. **Do not invent names for things.** If a standard name exists, use it. If
   none exists, describe the thing rather than coining a label the reader has to
   memorise. A private vocabulary makes the writer feel precise and makes the
   reader feel excluded.
5. **Prefer specifics to abstractions.** Give the number, the file path, the
   command, the date, the exact error text. "Slow" is an opinion. "15.6 ms
   against 60 microseconds" is a fact the reader can act on.
6. **One idea per sentence.** Most sentences should be under 25 words. Split any
   sentence over about 30 words unless the length is doing real work.
7. **Say what you do not know.** Mark guesses as guesses, unmeasured things as
   unmeasured, and opinions as opinions. A document that admits its gaps is
   trusted on the rest.
8. **Direct does not mean short.** Explain the reasoning in full. What to cut is
   the editorialising: the throat-clearing, the restatement, the commentary on
   how interesting the finding is.
9. **Do not presume shared context.** Write for a competent reader who has not
   been following along. Name the thing before referring to it.
10. **Fit the shape to the content.** Do not apply the same skeleton (opening
    restatement, three bullets, a twist, a closing line) to every document.

## Punctuation and formatting

- **Never use em dashes or en dashes.** Use a comma, a colon, a semicolon,
  brackets, or two sentences. Most asides should be a sentence of their own or
  be deleted.
- **Use full stops generously.** Two clear sentences beat one balanced one.
- **Bold at most one phrase per paragraph.**
- **Use a table when three or more items share the same shape.** Use a list when
  they do not.
- **Use headings that state the content**, so the headings alone summarise the
  document.

## Structure that helps

For a document that reports findings, give every item the same shape so a
reader can skim to the part they need:

```
### <A one-line statement of the problem>

**What happens.** The observable behaviour, in the present tense.

**Evidence.** The measurement, the file and line, or the command and its output.

**Why it matters.** The consequence for someone doing real work.

**Options.** What could be done. Written as options, not decisions, unless the
decision has actually been made.
```

## Before delivering

Run the revision pass in `references/revision-pass.md` on every draft. Search
for the phrases in `references/patterns-to-avoid.md` (borrowed metaphors,
"it turns out", "not X but Y", "simply", stacked hedges, summarising closers).
When the reader may be another agent or a future session, also apply
`references/machine-readers.md` (absolute dates, full paths, fixed status words).

## Do not overcorrect

- **Losing the reasoning.** If a conclusion depends on three measurements, give
  all three. Brevity that removes the evidence is worse than the original.
- **Flattening real distinctions.** Precise technical terms are not jargon. Keep
  them and define them.
- **Removing all structure.** A document with no headings, no tables and no
  shape is hard to use even when every sentence is plain.

## When a project has its own style guide

Follow the project's guide first, and use this skill for whatever it does not
cover. Check `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, or a README style
section before writing. Where they conflict, the project wins.

## References

- `references/patterns-to-avoid.md`: phrases to search for, with replacements.
- `references/revision-pass.md`: the ten-step check to run on every draft.
- `references/machine-readers.md`: extra rules for text read by agents or indexes.
- `references/rewrites.md`: before and after pairs, with the reason for each.
- `references/document-shapes.md`: skeletons for status updates, decision
  records, bug reports, commit messages, pull request descriptions, README
  openings.
