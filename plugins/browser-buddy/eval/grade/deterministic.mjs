// Deterministic grading pass.
//
// Scores every trial against its task answer key using three independent
// evidence sources: the final report text, the fixture server access log (what
// the trial actually fetched), and the stream-json tool trace (what commands it
// actually ran). The access log is what turns "it claimed to check page 3" into
// a checkable fact rather than a judgement call.
//
// Usage: node deterministic.mjs <run-dir>

import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = join(HERE, "..", "tasks");
const runDir = process.argv[2];
if (!runDir) {
  console.error("usage: node deterministic.mjs <run-dir>");
  process.exit(2);
}

const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const matchesAny = (text, patterns) =>
  (patterns || []).some((p) => {
    try {
      return new RegExp(p, "i").test(text);
    } catch {
      return text.toLowerCase().includes(String(p).toLowerCase());
    }
  });

const tasks = {};
for (const f of await readdir(TASKS_DIR)) {
  if (!f.endsWith(".json")) continue;
  const t = await readJson(join(TASKS_DIR, f));
  tasks[t.id] = t;
}

// Every agent-browser invocation the trial issued, plus which files it Read.
function toolTrace(streamText) {
  const commands = [];
  const readPaths = [];
  let toolErrors = 0;
  for (const line of streamText.split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === "assistant") {
      for (const block of ev.message?.content || []) {
        if (block.type !== "tool_use") continue;
        if (block.name === "Bash" && block.input?.command) commands.push(block.input.command);
        if (block.name === "Read" && block.input?.file_path) readPaths.push(block.input.file_path);
      }
    }
    if (ev.type === "user") {
      for (const block of ev.message?.content || []) {
        if (block.type === "tool_result" && block.is_error) toolErrors++;
      }
    }
  }
  return { commands, readPaths, toolErrors };
}

function processMetrics(trace) {
  const ab = trace.commands.filter((c) => /\bagent-browser\b/.test(c));
  const joined = ab.join("\n");
  const closeCmds = ab.filter((c) => /\bclose\b/.test(c));
  const sessioned = ab.filter((c) => /--session[= ]/.test(c));
  return {
    agent_browser_commands: ab.length,
    used_session_everywhere: ab.length > 0 && sessioned.length === ab.length,
    closed_session: closeCmds.length > 0,
    read_console: /\bconsole\b/.test(joined),
    read_errors: /\berrors\b/.test(joined),
    used_json_flag: /--json\b/.test(joined),
    used_jpeg: /--screenshot-format[= ]+jpeg/.test(joined),
    took_screenshot: /\bscreenshot\b/.test(joined),
    read_an_image: trace.readPaths.some((p) => /\.(jpe?g|png)$/i.test(p)),
    tool_errors: trace.toolErrors,
  };
}

// Which of the URLs the task requires were genuinely fetched by this trial.
function coverage(accessLog, task) {
  const lines = accessLog.split("\n").filter(Boolean);
  const urls = lines.map((l) => l.split("\t")[2] || "");
  const visited = [];
  const notVisited = [];
  for (const req of task.required_urls || []) {
    const hit = urls.some((u) => {
      if (req === "/") return u === "/";
      if (req.includes("?")) return u === req || u.startsWith(req);
      return u === req || u.startsWith(req + "?");
    });
    (hit ? visited : notVisited).push(req);
  }
  return { visited, not_visited: notVisited, total_requests: lines.length, urls };
}

// URLs the report cites that the browser never actually requested.
//
// This catches a specific and common failure: the agent visits a page, then
// writes up the finding against an invented, plausible-looking URL
// ("/order-summary" for a page really served at "/visual.html"). The evidence
// is fabricated even though the observation behind it was real, which makes the
// finding unactionable for anyone trying to reproduce it.
function fabricatedUrlCitations(report, cov) {
  const cited = report.match(/https?:\/\/localhost:\d+(\/[^\s)\]`"'>,]*)?/g) || [];
  const logged = new Set(cov.urls);
  const bad = [];
  for (const raw of [...new Set(cited)]) {
    const path = raw.replace(/^https?:\/\/localhost:\d+/, "") || "/";
    if (path === "/" || path === "") continue;
    const clean = path.replace(/[.,;:]$/, "");
    const hit = [...logged].some((u) => u === clean || u.split("?")[0] === clean.split("?")[0]);
    if (!hit) bad.push({ url: raw, why: "cited as evidence but never requested by the browser" });
  }
  return bad;
}

// A claim of coverage that the access log contradicts. This is the strongest
// available fabrication signal: it needs no judgement.
function provableFabrications(report, task, cov) {
  const out = [];
  for (const req of cov.not_visited) {
    const page = req.split("?")[0];
    const bare = page.replace(/^\//, "").replace(/\.html$/, "");
    const mentions =
      report.includes(req) ||
      (bare.length > 2 &&
        new RegExp(`\\b${bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(report));
    // page=3 style claims
    const pageNum = req.match(/page=(\d)/)?.[1];
    const claimsPage = pageNum && new RegExp(`page\\s*${pageNum}\\b`, "i").test(report);
    if (mentions || claimsPage) {
      out.push({
        url: req,
        why: "report references this page but the server access log has no request for it",
      });
    }
  }
  return out;
}

const trialsRoot = join(runDir, "trials");
const trialDirs = existsSync(trialsRoot) ? (await readdir(trialsRoot)).sort() : [];
const rows = [];

for (const name of trialDirs) {
  const dir = join(trialsRoot, name);
  if (!existsSync(join(dir, "result.json"))) continue;
  const meta = await readJson(join(dir, "meta.json"));
  const result = await readJson(join(dir, "result.json"));
  const task = tasks[meta.task];
  if (!task) continue;

  const report = String(result.result || "");
  const accessLog = existsSync(join(dir, "access.log"))
    ? await readFile(join(dir, "access.log"), "utf8")
    : "";
  const stream = existsSync(join(dir, "stream.jsonl"))
    ? await readFile(join(dir, "stream.jsonl"), "utf8")
    : "";

  const trace = toolTrace(stream);
  const proc = processMetrics(trace);
  const cov = coverage(accessLog, task);

  const found = [];
  const missed = [];
  for (const d of task.expected_defects || []) {
    (matchesAny(report, d.patterns) ? found : missed).push(d.id);
  }

  const factsCorrect = [];
  const factsMissed = [];
  const factsFabricated = [];
  for (const f of task.expected_facts || []) {
    const ok = matchesAny(report, f.patterns);
    if (ok) factsCorrect.push(f.id);
    else factsMissed.push(f.id);
    // If the report states a value of the right shape but the wrong value, that
    // is a fabricated fact, which is worse than failing to find it.
    if (!ok && f.hallucination_check?.pattern) {
      const m = report.match(new RegExp(f.hallucination_check.pattern, "g"));
      if (m && m.length) factsFabricated.push({ id: f.id, reported: [...new Set(m)] });
    }
  }

  const fabrications = provableFabrications(report, task, cov);
  const fabricatedUrls = fabricatedUrlCitations(report, cov);

  // A trial killed by a harness guard (turn cap, budget cap, timeout) returns no
  // report at all. Scoring it as 0% recall would measure the guard, not the agent,
  // so it is excluded from accuracy aggregates and surfaced as an incompleteness
  // rate instead. Its cost, turns and process behavior remain valid observations.
  const incomplete = !!result.is_error || report.length === 0;
  const incompleteReason =
    result.subtype && /^error_/.test(result.subtype)
      ? result.subtype
      : incomplete
        ? "no_report"
        : null;

  rows.push({
    trial: name,
    arm: meta.arm,
    task: meta.task,
    rep: meta.rep,
    model: meta.model,
    effort: meta.effort || "(none)",
    incomplete,
    incomplete_reason: incompleteReason,
    is_error: !!result.is_error,
    exit_code: result.exit_code,
    cost_usd: Number(result.total_cost_usd || 0),
    num_turns: Number(result.num_turns || 0),
    wall_seconds: Number(result.wall_seconds || 0),
    leaked_sessions: Number(result.leaked_sessions || 0),
    report_chars: report.length,
    expected_defects: (task.expected_defects || []).length,
    found,
    missed,
    facts_correct: factsCorrect,
    facts_missed: factsMissed,
    facts_fabricated: factsFabricated,
    provable_fabrications: fabrications,
    fabricated_url_citations: fabricatedUrls,
    coverage_visited: cov.visited.length,
    coverage_required: (task.required_urls || []).length,
    coverage_missing: cov.not_visited,
    http_requests: cov.total_requests,
    process: proc,
  });
}

await writeFile(join(runDir, "deterministic.json"), JSON.stringify(rows, null, 2));

const pct = (n, d) => (d === 0 ? "-" : `${Math.round((100 * n) / d)}%`);
const byArm = {};
for (const r of rows) {
  const a = (byArm[r.arm] ||= {
    trials: 0,
    scored: 0,
    incomplete: 0,
    defFound: 0,
    defTotal: 0,
    factOK: 0,
    factTotal: 0,
    factFab: 0,
    fabricated: 0,
    cost: 0,
    turns: 0,
    wall: 0,
    errors: 0,
    leaks: 0,
    closed: 0,
    console: 0,
    errbuf: 0,
    img: 0,
    covMissing: 0,
    covReq: 0,
    toolErr: 0,
  });
  a.trials++;
  // Cost, turns, process and leaks count for every trial. Accuracy counts only
  // for trials that actually produced a report.
  a.cost += r.cost_usd;
  a.turns += r.num_turns;
  a.wall += r.wall_seconds;
  a.leaks += r.leaked_sessions;
  a.closed += r.process.closed_session ? 1 : 0;
  a.console += r.process.read_console ? 1 : 0;
  a.errbuf += r.process.read_errors ? 1 : 0;
  a.img += r.process.read_an_image ? 1 : 0;
  a.toolErr += r.process.tool_errors;
  a.errors += r.is_error ? 1 : 0;
  if (r.incomplete) {
    a.incomplete++;
    continue;
  }
  a.scored++;
  a.defFound += r.found.length;
  a.defTotal += r.expected_defects;
  a.factOK += r.facts_correct.length;
  a.factTotal += r.facts_correct.length + r.facts_missed.length;
  a.factFab += r.facts_fabricated.length;
  a.fabricated += r.provable_fabrications.length + r.fabricated_url_citations.length;
  a.covMissing += r.coverage_missing.length;
  a.covReq += r.coverage_required;
}

console.log(`\nDeterministic grading: ${rows.length} trials in ${runDir}\n`);
const head = [
  "arm",
  "n",
  "done",
  "defects",
  "facts",
  "fab",
  "coverage",
  "closed",
  "console",
  "errbuf",
  "img",
  "toolErr",
  "$/trial",
  "turns",
  "sec",
];
console.log(head.join("\t"));
for (const [arm, a] of Object.entries(byArm)) {
  console.log(
    [
      arm,
      a.trials,
      `${a.scored}/${a.trials}`,
      `${a.defFound}/${a.defTotal} ${pct(a.defFound, a.defTotal)}`,
      `${a.factOK}/${a.factTotal}`,
      a.fabricated + a.factFab,
      pct(a.covReq - a.covMissing, a.covReq),
      pct(a.closed, a.trials),
      pct(a.console, a.trials),
      pct(a.errbuf, a.trials),
      pct(a.img, a.trials),
      a.toolErr,
      "$" + (a.cost / a.trials).toFixed(3),
      (a.turns / a.trials).toFixed(1),
      (a.wall / a.trials).toFixed(0),
    ].join("\t")
  );
}
const inc = rows.filter((r) => r.incomplete);
if (inc.length) {
  console.log(`\nIncomplete trials, excluded from accuracy metrics (${inc.length}):`);
  for (const r of inc) console.log(`  ${r.trial}  ${r.incomplete_reason}  turns=${r.num_turns}`);
}
console.log(`\nwrote ${join(runDir, "deterministic.json")}`);
