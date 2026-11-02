# The ledger

The ledger is the coordinator's record of where the work stands, so a fresh context can resume from it. Only the
coordinator writes it, and only through `scripts/ledger` (in the skill's `scripts/` folder, beside `wt`). Workers
never write to it.

It has two backends, picked by the `Ledger` setting in `.agents/coordinator.md` (see `config.md`):

- `github` (the default when `gh` is signed in and the origin is on GitHub): a run epic issue plus one sub-issue
  per task, in the `Ledger repo` (default: the origin's repo).
- `file`: `.agents/ledger.md` in the main checkout, kept out of git through `.git/info/exclude`. Nothing about
  the ledger is ever committed in either mode.

## Commands

| Command                                          | What it writes                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `status`                                         | nothing; prints the resume view                                                      |
| `config`                                         | nothing; prints mode, repo, run, project and plan dir                                |
| `labels`                                         | creates the label set (idempotent; `init` and `import` call it)                      |
| `init <goal>`                                    | opens the run epic                                                                   |
| `import <plan.md>`                               | one task issue per `## Task: <name>` section, as sub-issues of the run, with labels  |
|                                                  | and "blocked by" links; skips names that already exist, so a rescope plan adds to it |
| `state <task> <state> [--round n]`               | swaps the `state:` label (silent); `merged` and `dropped` close the issue            |
| `note <task\|run> <file\|-> [--head TEXT]`       | a comment: a builder report, a verdict, a blocked reason                             |
| `ruling <task\|run> <file\|-> --by WHO [--date]` | a comment quoting the owner's words, and a link in the run's Rulings list            |
| `land <wave> <sha> <task...> [--check TEXT]`     | adds `Landed: <sha>` to each task body, closes them, one result comment on the run   |
| `now <file\|->`                                  | replaces the run's "Now" section (silent)                                            |
| `ref <task>`                                     | nothing; prints `owner/repo#n` (file mode: `<plan path>#<task>`) for a dispatch      |
| `sync`                                           | replays writes queued while GitHub was unreachable                                   |

`<task>` is a task name, an issue number or `#n`. With more than one open run in the repo (two coordinators),
pass `--run <n>` on every call, or set `LEDGER_RUN`. Each coordinator touches only its own run.

## States

`planned`, `building`, `verifying`, `fixing` (with `--round n`), `passed`, `blocked`, `merged`, `dropped`. On
GitHub they are labels (`state:building`, `round:2`) and `merged`/`dropped` are the issue closed as completed or
not planned. Other labels: `run`, `task`, `tier:deep`/`tier:fast`, and `wave:<name>` from the plan.

## Quiet by default

People who watch the repo get an email for every new issue and comment. So:

- State changes are label and body edits, which notify no one.
- Comments are only for results: builder reports, verdicts, wave results, owner rulings, blocked reasons.
- The helper escapes every `@name` it posts (a zero-width space after the `@`), so nothing it writes mentions
  anyone. Never mention people in the ledger by other means.
- Bulk writes pause one second between creates (`LEDGER_THROTTLE` changes it), well under GitHub's limit of about
  80 created items a minute.

## Layout

The run epic body has four marked sections the helper edits in place: the goal, **Now** (what is in flight and
what comes next; it replaces handoff notes), **Plan** (the plan's text outside its task sections: goal, waves,
risks), and **Rulings** (one line per ruling, linking its comment).

A task issue's title is `<name>: <goal>` and its body is the planner's task section, verbatim. Comment headings:

- `**Builder (<tier>), <branch>, <commit>**` then the builder's reply.
- `**Verify round n: PASS**` (or FAIL) then the verifier's reply. `status` lists every line in a verdict that
  says CLOSE.
- `**Owner ruling**, <date>, <how it arrived>` then the words as a quote block.
- On the run: `**Wave <w> landed:** <sha>`, the tasks, and the check result.

## Status

`ledger status` makes one GraphQL query and prints about 30 lines:

```text
Run #12: Add a --json flag to every command
Now:
  Wave 2 building; json-core landed in 4f1c2aa.
Wave now: 2
building: json-cmds #15
fixing: json-docs #16 (round 2)
ready: json-tests #17
waiting: json-release #18
blocked: json-auth #19: Needs staging credentials (owner item posted)
merged: 3, dropped: 1, open: 5
CLOSE json-core #14: look CLOSE: table spacing tighter than the reference
Rulings: 2 (in the run body)
```

`ready` tasks have every "blocked by" task closed; `waiting` ones do not. Read this, not the issues.

## The project board

`Project: <owner>/<number>` adds each task to an org-level Projects v2 board and mirrors its state into a
single-select field named `State` (options named like the states). It is optional: labels are the source of
truth, and a board update that fails (for example without the `project` scope; `gh auth refresh -s project` adds
it) is reported and skipped.

## When GitHub fails

If a write fails and GitHub is unreachable or rate limited, the helper appends the command and its text to
`.agents/ledger-queue.jsonl` (also kept out of git) and returns success. Later writes queue behind it, so order is
kept, and the next write (or `ledger sync`) replays the queue first. `status` needs GitHub; when it is down,
work from your own context until it is back. `Ledger: file` runs the whole loop with no GitHub at all.

## Plans

The planner writes the plan into the plan dir (default `.agents/plans/`, kept out of git). Each task is a
`## Task: <name>` section with `**Goal:**`, `**Files:**`, `**Steps:**`, `**Tier:**`, `**Wave:**`,
`**Depends on:**` and the acceptance criteria; `import` reads the goal, tier, wave and dependencies from those
lines, with or without a leading `- `; a field line missing its bold markers fails the import and names the line. `init` reuses an open run with the same title. A plan file can be deleted once imported on GitHub; in file mode it is the task text, so keep it until the
run finishes.
