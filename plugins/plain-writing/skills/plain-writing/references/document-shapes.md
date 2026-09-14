# Document shapes

Skeletons for the documents that come up most often. Each one exists so that a
reader can find what they need without reading everything, and so that two
documents of the same kind look the same.

Use these as starting points, not as a form to fill in. Delete any section that
would be empty rather than writing "N/A".

## Findings or gap report

The document that says what was learned and what is still wrong. Written after
an investigation, an audit, or a proof of concept.

```markdown
# <What this is about>

<One paragraph: what this document covers, what it does not cover, and who it
is for. Say explicitly what is out of scope, so absences do not read as
oversights.>

## Words used in this file

<A table of any term the reader may not know. Skip this only if there are none.>

## How this was checked

<The machine, the version, the commit, the date. A table of each check, the
exact command, and the result. A reader must be able to re-run it.>

## What works

<Short. The gaps below only make sense against a baseline.>

## Where it falls short

### <A one-line statement of the problem>

**What happens.** <The observable behaviour, present tense.>

**Evidence.** <Measurement, file and line, or command and output.>

**Why it matters.** <The consequence for someone doing real work.>

**Options.** <What could be done. Options, not decisions.>

## What nobody has measured

<A table: the thing not measured, and why it matters.>

## Questions this leaves open

<Numbered. One question each. No answers unless someone has actually decided.>
```

## Status update

For a person who wants to know where things stand and whether they need to act.

```markdown
**Where it stands:** <one sentence, first>

**Done since last time:** <bullets, each with a link or an identifier>

**In progress:** <bullets, each with what it is waiting on>

**Blocked, and on whom:** <bullets, or "nothing">

**Decisions I need from you:** <numbered questions, or "none">
```

Put the blockers and the decisions where they cannot be missed. A status update
whose only purpose is to ask a question should say so in the first line.

## Decision record

Written when a choice is made, so that nobody re-litigates it from memory.

```markdown
# <The decision, stated as a sentence>

**Date:** <YYYY-MM-DD>
**Status:** proposed | accepted | superseded by <link>

## What we decided

<One paragraph. State the decision, not the discussion.>

## Why

<The reasons, in order of weight. Include the measurements if there are any.>

## What we gave up

<The cost of the choice. Be honest and specific.>

## What would make us revisit this

<Concrete triggers: a measurement crossing a threshold, a dependency changing,
a requirement arriving.>
```

## Bug report

```markdown
# <What is broken, in one line>

**Environment:** <version, OS, commit>

**What happens:** <observed behaviour>

**What should happen:** <expected behaviour>

**How to reproduce:**

1. <exact command>
2. <exact command>

**Evidence:** <verbatim error text, log excerpt, or file and line>

**Scope:** <who or what is affected, and how often>
```

Paste error text verbatim. Do not paraphrase an error message.

## Commit message

The subject line says what changed, in the imperative, under about 70
characters. The body says why, and what a reader would otherwise have to
reconstruct from the diff.

```
<Imperative summary of the change>

<Why the change was needed. What was wrong before, or what was missing.>

<What the change actually does, at the level of behaviour rather than
line-by-line. Name the interesting decisions and anything surprising.>

<Anything checked: tests run, measurements taken, things deliberately not
done.>
```

Do not write a commit message that only restates the diff. A reader can see the
diff. They cannot see why.

## Pull request description

```markdown
## What this does

<One paragraph, first sentence is the summary.>

## Why

<The problem this solves. Link the issue if there is one.>

## How to check it

<Exact commands, and what the reviewer should see.>

## Anything a reviewer should know

<Trade-offs, things deliberately left out, parts you are unsure about.>
```

Naming the parts you are unsure about gets them reviewed. Hiding them does not
make them safer.

## README opening

The first paragraph of a README is the most-read prose in a project. It should
answer three questions before any heading:

1. What is this?
2. Who is it for?
3. What state is it in?

```markdown
# <name>

<One sentence: what it does, in the plainest possible words.>

<One paragraph: what problem it solves and who has that problem.>

<One sentence on its state: production, experimental, reference only,
abandoned. Do not make the reader infer this from the commit history.>
```

## Answering a question in chat

Not a document, but the same rules apply and it is where they are most often
dropped.

- First line answers the question. Yes, no, the number, or the name.
- Then the evidence or the reasoning.
- Then anything the person did not ask but needs to know.
- If you did not do part of what was asked, say so explicitly, near the top.
- If you are guessing, say so in the same sentence as the guess.
