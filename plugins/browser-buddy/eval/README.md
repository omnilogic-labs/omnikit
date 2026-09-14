# browser-buddy evaluation harness

Measures how well the browser-buddy agent actually performs, across model and reasoning-effort
configurations, against a local site with **deliberately planted defects and a known answer key**.

It exists to answer one question with evidence rather than impression: when browser-buddy reports
something that is not true, is that the model, the reasoning budget, or the prompt?

## Why a fixture site

Grading against live sites cannot distinguish "the agent missed it" from "the site changed", and
cannot prove a claim was invented. Here every defect is planted, so the answer key is exact, and the
fixture server logs every request, so a coverage claim can be checked against what the browser
actually fetched.

## What is measured

Three independent evidence sources per trial:

| Source                    | What it proves                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final report text         | What the agent claims                                                                                                                               |
| Fixture server access log | What the browser genuinely fetched. A claim about a page absent from this log is a **provable fabrication**, not a matter of opinion                |
| stream-json tool trace    | Which commands actually ran: `--session` hygiene, `close`, `console`, `errors`, `--json`, JPEG screenshots, and whether an image was ever read back |

Headline metrics: defect recall, exact-fact accuracy, **fabrication rate**, false-positive rate,
required-page coverage, session-close compliance, failed tool calls, cost per trial, and cost per
defect found.

## The arms

Defined in `arms.json`. All three run the **byte-identical** prompt, extracted at run time from
`../agents/browser-buddy.md`, and differ only in two CLI flags.

| Arm          | Flags                                                                        |
| ------------ | ---------------------------------------------------------------------------- |
| `haiku`      | `--model claude-haiku-4-5` (Haiku 4.5 does not support effort levels)        |
| `sonnet-low` | `--model claude-sonnet-5 --effort low` (verified to emit no thinking blocks) |
| `sonnet-med` | `--model claude-sonnet-5 --effort medium` (the shipped configuration)        |

`model` and `effort` are deliberately omitted from the inline agent definition so the session flags
are the single source of each arm's configuration. Because the prompt is read from the agent file at
run time, editing the agent automatically changes what is under test.

There is no "no reasoning" setting: `--effort` accepts only `low|medium|high|xhigh|max`. Empirically
`--effort low` produces no thinking blocks at all, so it is the practical floor for Sonnet.

## The fixtures

`fixtures/site/`, served by `fixtures/server.mjs` with an access log.

| Page                   | Planted ground truth                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `clean.html`           | **Nothing wrong.** Negative control: any finding is a false positive                                                          |
| `console-error.html`   | Looks perfect. `/api/inventory` returns 500 and an uncaught `TypeError` fires. Only findable in the logs                      |
| `modal.html`           | Reference `ZX-4417`, built at click time, invisible to `snapshot -i` even when open                                           |
| `visual.html`          | Accessibility tree is healthy; CSS renders the primary button white-on-white and covers a line with a banner. Screenshot-only |
| `checkout.html`        | Happy path yields `ORD-90210`; a malformed email is silently accepted                                                         |
| `links.html`           | Six links, exactly two bad: a real 404 and a dead `href="#"`                                                                  |
| `slow.html`            | **Nothing wrong**, just 3s slow. Reporting it broken means it skipped `wait`                                                  |
| `table.html?page=1..3` | Negative price on row 27, which lives on page 3 only                                                                          |

## Running

```bash
./run.sh --reps 5                                         # full grid, 90 trials
./run.sh --reps 1 --arms sonnet-med --tasks t3-extraction # one cell
./run.sh --reps 5 --jobs 4 --run-id main                  # resume/extend an existing run
```

Runs are **restartable**: a trial whose `result.json` exists is skipped, so re-invoking with a higher
`--reps` extends the same run instead of repeating it.

Each trial gets a dedicated fixture server on its own port and a per-trial screenshot directory. Any
agent-browser session a trial opens and fails to close is detected, recorded as a leak, and cleaned up.

Guards per trial: `--max-budget-usd 3.00`, a per-task `max_turns`, and a 900s timeout.

Results default to `~/.cache/browser-buddy-eval/<run-id>/` rather than the repo, so trials do not
inherit the repo's `CLAUDE.md` as ambient context.

## Grading

```bash
node grade/deterministic.mjs ~/.cache/browser-buddy-eval/main # answer key + access log + tool trace
./grade/judge.sh ~/.cache/browser-buddy-eval/main             # blind LLM judge
node grade/report.mjs ~/.cache/browser-buddy-eval/main > report.md
```

The judge never sees which arm produced a report and receives trials in shuffled order. It defaults to
Opus at roughly $0.33 per report; pass `--model claude-sonnet-5` to cut that by about 5x if the budget
matters more than adjudication quality.

The deterministic pass is the backbone. The judge only resolves what regex cannot: whether a finding is
a genuine hit, a false positive, or a claim the agent had no way to observe.

## Known limits

- Prompt caching makes per-trial cost order-dependent; `deterministic.json` keeps the raw usage.
- A small auxiliary Haiku cost appears in every trial (harness-internal) and is included in totals.
- Planted defects measure _process_ (does it look, does it read logs, does it verify) more faithfully
  than they measure real-site difficulty.
- With n=5 per cell this detects large differences, not subtle ones. Fabrication rate separates arms
  most cleanly because a single fabrication is a hard binary event.

## A finding worth knowing about the CLI

As of agent-browser 0.32.1, `agent-browser errors` prints each captured exception as a bare `✗` with
no message. The exception text is only visible via `agent-browser errors --json`. An operator told to
"read errors before deciding what is wrong" therefore sees an apparently empty buffer. This is a
plausible contributor to confident-but-wrong reports, independent of which model is driving.
