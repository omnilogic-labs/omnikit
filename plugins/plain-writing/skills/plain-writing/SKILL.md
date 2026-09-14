---
name: plain-writing
description: >-
  Write prose a person can read once and act on: technical documentation,
  findings, status updates, summaries, explanations, decision records, commit
  messages and pull request descriptions. Use whenever producing prose that
  someone else will read, and whenever asked to write plainly, simply, clearly,
  in plain language, in plain English, without jargon, or to make a draft easier
  to follow. Triggers include "write this up", "document this", "summarise
  this", "explain this", "in plain language", "make this clearer", "too
  verbose", "too clever", "less jargon", "I had to read that twice".
---

# plain-writing

How to write so that a reader understands on the first pass. This exists
because fluent writing and clear writing are different things. Fluent writing
sounds good when read aloud. Clear writing puts a fact in the reader's head with
the least effort on their part. When the two conflict, choose clear.

The habits below are the ones that most often make otherwise competent technical
writing hard to read: delaying the point for effect, inventing vocabulary,
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

A paragraph should open with the thing you want the reader to know. Everything
after it is evidence, qualification, or consequence. If a paragraph only makes
sense once you reach the last sentence, move that sentence to the front and
rewrite what is left.

The same applies at every scale: the document opens with its conclusion, each
section opens with its finding, each sentence opens with its subject.

Bad, because the point arrives last:

> Across five runs the queue peaked between 193 KB and 262 KB, against a 256 KB
> limit, and the flood took 1.7 seconds on the shared runner against 0.9 seconds
> locally, which suggests the failure is caused by the machine rather than the
> code.

Good, because the point arrives first:

> The failure is caused by the machine, not the code. Across five runs the queue
> peaked between 193 KB and 262 KB against a 256 KB limit, and the flood took
> 1.7 seconds on the shared runner against 0.9 seconds locally.

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

## Words and patterns to avoid

| Pattern                                                                                | Why it hurts                                                | Do this instead                                              |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| "load-bearing", "the seam", "surface area", "pressure test", "wired up", "smoking gun" | Borrowed metaphors. Each reader decodes them differently.   | Say the literal thing: "required", "the interface", "tested" |
| "It turns out", "The thing is", "What is interesting is", "Here is the thing"          | Delays the claim by a sentence and adds nothing.            | Delete the opener and start with the claim.                  |
| "not X, but Y" and "it is not just X, it is Y"                                         | Implies the reader believed X. Usually they had no opinion. | State Y. Mention X only if someone actually claimed it.      |
| "non-trivial", "significant", "substantial"                                            | Sounds measured, gives no measurement.                      | Give the number, the duration, or the count.                 |
| "simply", "just", "obviously", "of course"                                             | Tells the reader they should already have understood.       | Delete. If the step is easy, the reader will notice.         |
| Rhetorical questions as headings                                                       | The reader has to read the section to learn what it says.   | Make the heading a statement of the finding.                 |
| "In other words", "to put it another way"                                              | If a second phrasing is needed, the first one failed.       | Keep the clearer version, delete the other.                  |
| Stacked hedges: "it seems like it might possibly"                                      | Reads as evasion and hides how confident you actually are.  | State the confidence once: "probably", or give the evidence. |
| Inanimate subjects acting: "the measurement wants to", "the design pushes back"        | Hides who or what is responsible.                           | Name the actor: "the measurement shows", "I expect".         |
| "dive into", "unpack", "let us explore"                                                | Filler that delays the content.                             | Start the content.                                           |
| A closing line that summarises what was just said                                      | The reader has just read it.                                | Stop when the content stops.                                 |

## Punctuation and formatting

- **Never use em dashes or en dashes.** Use a comma, a colon, a semicolon,
  brackets, or two sentences. Beyond the house style, the em dash is where the
  aside hides, and most asides should either be a sentence of their own or be
  deleted.
- **Use full stops generously.** Two clear sentences beat one balanced one.
- **Bold at most one phrase per paragraph.** Three bold phrases in a paragraph
  mean none of them stand out.
- **Use a table when three or more items share the same shape.** Use a list when
  they do not.
- **Use headings that state the content**, so the headings alone summarise the
  document.

## Structure that helps

For a document that reports findings, give every item the same shape. Repetition
of structure is what lets a reader skim to the part they need. A shape that
works:

```
### <A one-line statement of the problem>

**What happens.** The observable behaviour, in the present tense.

**Evidence.** The measurement, the file and line, or the command and its output.

**Why it matters.** The consequence for someone doing real work.

**Options.** What could be done. Written as options, not decisions, unless the
decision has actually been made.
```

Other useful shapes are in `references/document-shapes.md`: status updates,
decision records, bug reports, commit messages, pull request descriptions, and
README openings.

## Writing for machines as well as people

The same document is often read by another agent, a search index, or a future
session with no memory of this one. These cost nothing and help both audiences:

- Use absolute dates ("2026-09-03"), never relative ones ("last week").
- Use full paths and exact command lines, so they can be copied and run.
- Keep table columns identical between tables of the same kind.
- Avoid pronouns whose subject is more than one sentence back. Repeat the noun.
- Do not rely on irony, understatement, or implication. State the thing.
- Use a fixed vocabulary for status words and use it consistently. If a check
  can be "pass", "fail" or "not run", never also write "green" or "clean".
- Put one fact in one row or one bullet. Do not bury a second fact in a clause.

## The revision pass

Run this against every draft before delivering it. It takes a few minutes and
catches most of what makes writing hard to read.

1. Read the first sentence of each paragraph on its own. Does each state the
   paragraph's point? If not, move the point to the front.
2. Search for em dashes and en dashes. Remove every one.
3. Search for each pattern in the table above. Fix what you find.
4. Find every term you invented or borrowed as a metaphor. Replace it with a
   plain description, or define it at first use.
5. Find every vague quantity. Replace it with a measurement, or say plainly that
   it has not been measured.
6. Split every sentence over about 30 words.
7. Read the headings alone, in order. Do they tell the story of the document?
8. Find every claim you cannot support. Either support it or label it as a
   guess.
9. Delete sentences that comment on the writing rather than the subject.
10. Read the whole thing as a competent person who has not seen the work. Mark
    anything that needs knowledge you did not supply, and supply it.

## Do not overcorrect

Clear writing is not baby talk, and it is not a bullet list with the reasoning
removed. Three failure modes to avoid while applying this:

- **Losing the reasoning.** If a conclusion depends on three measurements, give
  all three. Brevity that removes the evidence is worse than the original.
- **Flattening real distinctions.** Precise technical terms are not jargon. Keep
  them and define them.
- **Removing all structure.** A document with no headings, no tables and no
  shape is hard to use even when every sentence is plain.

## When a project has its own style guide

Follow the project's guide first, and use this skill for whatever the guide does
not cover. Check for a `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, or a style
section in the README before writing. Where they conflict, the project wins.

## References

- `references/rewrites.md`: before and after pairs, with the reason for each
  change.
- `references/document-shapes.md`: skeletons for common document types.
