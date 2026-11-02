// Runs the coordinator's ledger helper against a stub gh. No real GitHub repo is touched.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LEDGER = join(import.meta.dir, "../src/skills/coordinator/scripts/ledger");

// The stub keeps its state in $STUB: issues.json (open issues), status.json (graphql
// status data), calls.log (one line per gh call). `--jq` is applied with the real jq.
const STUB_GH = `#!/bin/bash
echo "$*" >> "$STUB/calls.log"
jq_arg() { while [ $# -gt 0 ]; do [ "$1" = --jq ] && { echo "$2"; return; }; shift; done; }
J="$(jq_arg "$@")"
out() { if [ -n "$J" ]; then jq -r "$J"; else cat; fi; }
case "$1 $2" in
  "auth token") echo token ;;
  "issue list") out < "$STUB/issues.json" ;;
  "issue create")
    n=$(( $(jq length "$STUB/issues.json") + 100 ))
    t=""; while [ $# -gt 0 ]; do [ "$1" = --title ] && t="$2"; shift; done
    jq --arg t "$t" --argjson n $n '. + [{number: $n, title: $t, body: ""}]' "$STUB/issues.json" > "$STUB/i.tmp" && mv "$STUB/i.tmp" "$STUB/issues.json"
    echo "https://github.com/o/r/issues/$n" ;;
  "issue view") echo '{"id":"ID","body":"<!-- ledger:rulings -->\\n<!-- /ledger:rulings -->"}' | out ;;
  "issue comment") echo "https://github.com/o/r/issues/1#c" ;;
  "api graphql")
    if [[ "$*" == *"issues(first: 10"* ]]; then out < "$STUB/status.json"
    elif [[ "$*" == *'$c: Int!'* ]]; then out < "$STUB/issue.json"
    elif [[ "$*" == *updatedAt* ]]; then out < "$STUB/tasks.json"
    else echo '{"data":{"repository":{"issue":{"subIssues":{"nodes":[]}}}}}' | out; fi ;;
  "label list") ;;
esac
exit 0
`;

let root = "";
let stub = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ledger-test-"));
  stub = join(root, "stub");
  mkdirSync(join(stub, "bin"), { recursive: true });
  writeFileSync(join(stub, "bin/gh"), STUB_GH);
  chmodSync(join(stub, "bin/gh"), 0o755);
  writeFileSync(join(stub, "issues.json"), "[]");
  const repo = join(root, "repo");
  mkdirSync(join(repo, ".agents"), { recursive: true });
  writeFileSync(join(repo, ".agents/coordinator.md"), "- Ledger: github\n- Ledger repo: o/r\n");
  Bun.spawnSync(["git", "init", "-q", repo]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function ledger(args: string[], stdin = "") {
  const p = Bun.spawnSync(["bash", LEDGER, ...args], {
    cwd: join(root, "repo"),
    stdin: new TextEncoder().encode(stdin),
    env: {
      ...process.env,
      PATH: `${join(stub, "bin")}:${process.env.PATH}`,
      STUB: stub,
      LEDGER_THROTTLE: "0",
    },
  });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}
const calls = () => readFileSync(join(stub, "calls.log"), "utf8").split("\n");
const creates = () => calls().filter((c) => c.startsWith("issue create"));

const PLAN = (fields: string) => `# Plan\n\n**Goal:** Ship it\n\n## Task: alpha\n\n${fields}\n`;

test("import reads plan fields written without a list marker", () => {
  writeFileSync(
    join(stub, "issues.json"),
    JSON.stringify([{ number: 1, title: "Run: Ship it", body: "" }])
  );
  const plan = join(root, "plan.md");
  writeFileSync(
    plan,
    PLAN("**Goal:** Do alpha\n**Wave:** G9\n**Tier:** deep\n**Depends on:** none")
  );
  const r = ledger(["import", plan]);
  expect(r.code).toBe(0);
  const c = creates().find((x) => x.includes("--title alpha: Do alpha"));
  expect(c).toBeDefined();
  expect(c).toContain("wave:G9");
  expect(c).toContain("tier:deep");
});

test("import fails loudly on a field line without bold markers", () => {
  const plan = join(root, "plan.md");
  writeFileSync(plan, PLAN("Wave: G9"));
  const r = ledger(["import", plan]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("Wave: G9");
  expect(creates()).toHaveLength(0);
});

test("init reuses an open run with the same goal", () => {
  expect(ledger(["init", "Ship it"]).code).toBe(0);
  const r = ledger(["init", "Ship it"]);
  expect(r.code).toBe(0);
  expect(creates()).toHaveLength(1);
  expect(r.out.trim()).toBe("100");
});

test("import opens one run even when another import opened it first", () => {
  const plan = join(root, "plan.md");
  writeFileSync(plan, PLAN("- **Goal:** Do alpha"));
  // The race: the run appears between import's "is there a run" check and its init.
  expect(ledger(["init", "Ship it"]).code).toBe(0);
  expect(ledger(["import", plan]).code).toBe(0);
  expect(creates().filter((c) => c.includes("--label run"))).toHaveLength(1);
});

test("ruling accepts run as the target", () => {
  writeFileSync(
    join(stub, "issues.json"),
    JSON.stringify([{ number: 7, title: "Run: Ship it", body: "" }])
  );
  const r = ledger(["ruling", "run", "-", "--by", "in chat"], "Go ahead.\n");
  expect(r.code).toBe(0);
  expect(calls().some((c) => c.startsWith("issue comment 7 "))).toBe(true);
});

const task = (number: number, title: string, labels: string[], comment = "") => ({
  number,
  title,
  state: "OPEN",
  stateReason: null,
  labels: { nodes: labels.map((name) => ({ name })) },
  blockedBy: { nodes: [] },
  comments: { nodes: comment ? [{ body: comment }] : [] },
});
const status = (nodes: unknown[]) =>
  writeFileSync(
    join(stub, "status.json"),
    JSON.stringify({
      data: {
        repository: {
          issues: {
            nodes: [{ number: 1, title: "Run: Ship it", body: "", subIssues: { nodes } }],
          },
        },
      },
    })
  );

test("status sorts waves naturally", () => {
  status([
    task(2, "a: x", ["state:planned", "wave:G53j"]),
    task(3, "b: x", ["state:planned", "wave:G9"]),
    task(4, "c: x", ["state:planned", "wave:G10"]),
    task(5, "d: x", ["state:planned", "wave:G53"]),
  ]);
  expect(ledger(["status"]).out).toContain("Wave now: G9\n");
  status([
    task(2, "a: x", ["state:planned", "wave:G53j"]),
    task(5, "d: x", ["state:planned", "wave:G53"]),
  ]);
  expect(ledger(["status"]).out).toContain("Wave now: G53\n");
  status([
    task(2, "a: x", ["state:planned", "wave:G53j"]),
    task(5, "d: x", ["state:planned", "wave:G53b"]),
  ]);
  expect(ledger(["status"]).out).toContain("Wave now: G53b\n");
});

test("status shows a blocked task's reason, not its note heading", () => {
  status([
    task(
      2,
      "auth: x",
      ["state:blocked"],
      "**Blocked: needs credentials**\n\nNeeds staging credentials from the owner."
    ),
  ]);
  const out = ledger(["status"]).out;
  expect(out).toContain("blocked: auth #2: Needs staging credentials from the owner.");
  expect(out).not.toContain("Blocked: needs credentials");
});

// Lean reads: plain text, no JSON envelope or URLs.
const BODY =
  "- **Goal:** make it fast\n- **Files:** `a.ts`\n- **Steps:**\n  1. do it\n- **Tier:** fast\n- **Wave:** G2\n- **Depends on:** none";
const issue = (number: number, updatedAt: string, comments: string[]) => ({
  number,
  title: `speed: make it fast`,
  state: "OPEN",
  stateReason: null,
  updatedAt,
  body: BODY,
  labels: { nodes: [{ name: "state:fixing" }, { name: "round:2" }, { name: "wave:G2" }] },
  comments: {
    nodes: comments.map((body, i) => ({ createdAt: `2026-11-0${i + 1}T10:00:00Z`, body })),
  },
});
const LONG = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
const runWith = (nodes: unknown[]) => {
  writeFileSync(
    join(stub, "issues.json"),
    JSON.stringify([{ number: 1, title: "Run: x", body: "" }])
  );
  writeFileSync(
    join(stub, "tasks.json"),
    JSON.stringify({ data: { repository: { issue: { subIssues: { nodes } } } } })
  );
};
const one = (i: unknown) =>
  writeFileSync(join(stub, "issue.json"), JSON.stringify({ data: { repository: { issue: i } } }));

test("show prints the task as text with the last result trimmed", () => {
  one(
    issue(5, "2026-11-02T10:00:00Z", [
      "**Builder (fast), wave/speed, abc**\n\nold",
      `**Verify round 1: FAIL**\n${LONG}`,
    ])
  );
  const r = ledger(["show", "o/r#5"]);
  expect(r.code).toBe(0);
  expect(r.out).toContain(
    "#5 speed: make it fast\n[fixing, round 2, wave G2] updated 2026-11-02 10:00"
  );
  expect(r.out).toContain("1. do it");
  expect(r.out).toContain("Verify round 1: FAIL");
  expect(r.out).not.toContain("Builder (fast)");
  expect(r.out).toContain("[16 more lines; --full]");
  expect(r.out).not.toMatch(/https?:|"body"|\{/);
});

test("show --brief keeps only the key field lines", () => {
  one(issue(5, "2026-11-02T10:00:00Z", []));
  const out = ledger(["show", "5", "--brief", "--last", "0"]).out;
  expect(out).toContain("Goal: make it fast\nTier: fast\nWave: G2\nDepends on: none");
  expect(out).not.toContain("a.ts");
});

test("comments --heads gives one line per result", () => {
  one(
    issue(5, "2026-11-02T10:00:00Z", [
      "**Verify round 1: FAIL**\n\ntests fail",
      "**Verify round 2: PASS**\n\nall pass",
    ])
  );
  const out = ledger(["comments", "5", "--heads", "--since", "2026-11-02"]).out.trim();
  expect(out).toBe("2026-11-02 **Verify round 2: PASS** all pass");
});

test("grep prints matching lines with their task", () => {
  runWith([issue(5, "2026-11-02T10:00:00Z", ["**Owner ruling**\n\n> keep the shards"])]);
  const out = ledger(["grep", "SHARDS"]).out.trim();
  expect(out).toBe("#5 speed: keep the shards");
});

test("index caches gists by updatedAt and marks changed tasks stale", () => {
  runWith([issue(5, "2026-11-02T10:00:00Z", []), issue(6, "2026-11-02T10:00:00Z", [])]);
  const stale = ledger(["index", "--stale"]);
  expect(stale.out).toContain("=== #5 speed [fixing]");
  expect(stale.out).toContain("Goal: make it fast");
  expect(ledger(["index", "--save", "-"], "#5 speed work | waits on owner\n6 other\n").code).toBe(
    0
  );
  expect(ledger(["index"]).out).toBe(
    "#5 speed [fixing]: speed work | waits on owner\n#6 speed [fixing]: other\n"
  );
  expect(ledger(["index", "--stale"]).out).toBe("");
  runWith([issue(5, "2026-11-03T09:00:00Z", []), issue(6, "2026-11-02T10:00:00Z", [])]);
  expect(ledger(["index"]).out).toContain("#5 speed [fixing]: (stale)");
  expect(ledger(["index", "--stale"]).out).toContain("=== #5");
});

test("note --from posts the reply the worker saved, once", () => {
  writeFileSync(
    join(stub, "issues.json"),
    JSON.stringify([{ number: 1, title: "Run: x", body: "" }])
  );
  const wt = join(root, "repo");
  const saved = Bun.spawnSync([
    "git",
    "-C",
    wt,
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "ledger-reply.md",
  ])
    .stdout.toString()
    .trim();
  writeFileSync(saved, "wave/speed abc123\nPASS check\n");
  const r = ledger(["note", "5", "--from", wt, "--head", "Builder (fast), wave/speed, abc123"]);
  expect(r.code).toBe(0);
  expect(r.out.trim().split("\n")).toHaveLength(1);
  expect(calls().some((c) => c.startsWith("issue comment 5 "))).toBe(true);
  const again = ledger(["note", "5", "--from", wt]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("no saved reply");
});
