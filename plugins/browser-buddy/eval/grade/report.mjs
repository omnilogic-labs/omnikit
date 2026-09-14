// Merges the deterministic pass and the blind judge pass into the final comparison.
//
// Usage: node report.mjs <run-dir> > report.md

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const runDir = process.argv[2];
if (!runDir) {
  console.error("usage: node report.mjs <run-dir>");
  process.exit(2);
}
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const rows = await readJson(join(runDir, "deterministic.json"));

for (const r of rows) {
  const jp = join(runDir, "trials", r.trial, "judge.json");
  r.judge = existsSync(jp) ? await readJson(jp) : null;
}

const arms = [...new Set(rows.map((r) => r.arm))];
const taskIds = [...new Set(rows.map((r) => r.task))].sort();
const armLabel = {
  haiku: "Haiku 4.5",
  "sonnet-low": "Sonnet 5, low",
  "sonnet-med": "Sonnet 5, medium",
};

const agg = (arm) => {
  const all = rows.filter((r) => r.arm === arm);
  // Accuracy is computed only over trials that produced a report. Cost, turns,
  // process behavior and the incompleteness rate itself cover every trial.
  const rs = all.filter((r) => !r.incomplete);
  const n = all.length || 1;
  const sum = (f) => rs.reduce((a, r) => a + f(r), 0);
  const sumAll = (f) => all.reduce((a, r) => a + f(r), 0);
  const judged = rs.filter((r) => r.judge);
  const jsum = (f) => judged.reduce((a, r) => a + f(r), 0);
  const defTotal = sum((r) => r.expected_defects);
  // Judge recall is authoritative where available; regex is the fallback.
  const defFound = judged.length
    ? jsum((r) => r.judge.defects_identified.length) +
      rs.filter((r) => !r.judge).reduce((a, r) => a + r.found.length, 0)
    : sum((r) => r.found.length);
  const factTotal = sum((r) => r.facts_correct.length + r.facts_missed.length);
  return {
    n: all.length,
    scored: rs.length,
    incomplete: all.length - rs.length,
    incompleteReasons: [
      ...new Set(all.filter((r) => r.incomplete).map((r) => r.incomplete_reason)),
    ],
    defFound,
    defTotal,
    recall: defTotal ? defFound / defTotal : null,
    factOK: sum((r) => r.facts_correct.length),
    factTotal,
    factAcc: factTotal ? sum((r) => r.facts_correct.length) / factTotal : null,
    // Includes fabricated URL citations: evidence pointing at a URL the browser
    // never requested is invented evidence, and is the strongest objective signal
    // the harness has. Omitting it here previously zeroed out the headline.
    fabProvable:
      sum((r) => r.provable_fabrications.length) +
      sum((r) => r.facts_fabricated.length) +
      sum((r) => r.fabricated_url_citations.length),
    fabJudged: jsum((r) => r.judge.fabrications.length),
    falsePos: jsum((r) => r.judge.false_positives.length),
    // Provable only. Judged fabrications are counted separately because they
    // depend on the answer key being a complete description of the page: a true
    // detail the key does not happen to list reads to the judge as invented.
    trialsWithFab: rs.filter(
      (r) =>
        r.provable_fabrications.length > 0 ||
        r.facts_fabricated.length > 0 ||
        r.fabricated_url_citations.length > 0
    ).length,
    trialsWithFP: judged.filter((r) => r.judge.false_positives.length > 0).length,
    correctVerdict: judged.filter((r) => r.judge.reached_correct_overall_verdict).length,
    judgedN: judged.length,
    scoredN: rs.length,
    coverage:
      sum((r) => r.coverage_required - r.coverage_missing.length) /
      (sum((r) => r.coverage_required) || 1),
    closed: sumAll((r) => (r.process.closed_session ? 1 : 0)) / n,
    leaks: sumAll((r) => r.leaked_sessions),
    console: sumAll((r) => (r.process.read_console ? 1 : 0)) / n,
    errbuf: sumAll((r) => (r.process.read_errors ? 1 : 0)) / n,
    img: sumAll((r) => (r.process.read_an_image ? 1 : 0)) / n,
    jsonFlag: sumAll((r) => (r.process.used_json_flag ? 1 : 0)) / n,
    toolErr: sumAll((r) => r.process.tool_errors) / n,
    cost: sumAll((r) => r.cost_usd) / n,
    costTotal: sumAll((r) => r.cost_usd),
    turns: sumAll((r) => r.num_turns) / n,
    wall: sumAll((r) => r.wall_seconds) / n,
    errors: sumAll((r) => (r.is_error ? 1 : 0)),
  };
};

const P = (x) => (x == null ? "-" : `${Math.round(x * 100)}%`);
const D = (x) => `$${x.toFixed(3)}`;
const A = Object.fromEntries(arms.map((a) => [a, agg(a)]));

const out = [];
out.push(`# browser-buddy model and effort comparison\n`);
out.push(`Run: \`${runDir}\``);
out.push(
  `Trials: ${rows.length} (${arms.length} arms x ${taskIds.length} tasks x ${Math.max(...rows.map((r) => r.rep))} reps)\n`
);

out.push(`## Headline\n`);
out.push(`| Metric | ${arms.map((a) => armLabel[a] || a).join(" | ")} |`);
out.push(`|---|${arms.map(() => "---").join("|")}|`);
const line = (label, f) => out.push(`| ${label} | ${arms.map((a) => f(A[a])).join(" | ")} |`);
line("Trials", (x) => x.n);
line(
  "**Produced a report at all**",
  (x) => `**${x.scored}/${x.n}**${x.incomplete ? ` (${x.incompleteReasons.join(", ")})` : ""}`
);
out.push(
  `\n_Accuracy rows below are computed over the ${arms.map((a) => `${A[a].scored}`).join("/")} trials that produced a report; cost, turns, process and leak rows cover all trials._\n`
);
out.push(`| Metric | ${arms.map((a) => armLabel[a] || a).join(" | ")} |`);
out.push(`|---|${arms.map(() => "---").join("|")}|`);
line("Defect recall", (x) => `${P(x.recall)} (${x.defFound}/${x.defTotal})`);
line("Exact-fact accuracy", (x) => `${P(x.factAcc)} (${x.factOK}/${x.factTotal})`);
line(
  "**Trials containing a fabrication**",
  (x) => `**${x.trialsWithFab}/${x.n}** (${P(x.trialsWithFab / x.n)})`
);
line("Fabrications, provable from the access log", (x) => x.fabProvable);
line("Fabrications, judged (see caveat)", (x) => x.fabJudged);
line("Trials with a false positive", (x) => `${x.trialsWithFP}/${x.judgedN}`);
line("Correct overall verdict", (x) => `${x.correctVerdict}/${x.judgedN}`);
line("Required-page coverage", (x) => P(x.coverage));
line("Closed its session", (x) => P(x.closed));
line("Leaked sessions (count)", (x) => x.leaks);
line("Read console", (x) => P(x.console));
line("Read errors buffer", (x) => P(x.errbuf));
line("Read a screenshot", (x) => P(x.img));
line("Used --json", (x) => P(x.jsonFlag));
line("Failed tool calls per trial", (x) => x.toolErr.toFixed(1));
line("Hard errors", (x) => x.errors);
line("Mean turns", (x) => x.turns.toFixed(1));
line("Mean wall seconds", (x) => x.wall.toFixed(0));
line("**Mean cost per trial**", (x) => `**${D(x.cost)}**`);
line("Total cost", (x) => D(x.costTotal));

out.push(`\n### Cost of accuracy\n`);
out.push(`| Arm | $/trial | Defect recall | $ per defect found | Fabrication rate |`);
out.push(`|---|---|---|---|---|`);
for (const a of arms) {
  const x = A[a];
  const perDefect = x.defFound ? x.costTotal / x.defFound : null;
  out.push(
    `| ${armLabel[a] || a} | ${D(x.cost)} | ${P(x.recall)} | ${perDefect ? D(perDefect) : "-"} | ${P(x.trialsWithFab / x.n)} |`
  );
}

out.push(`\n## Per task\n`);
out.push(`| Task | Metric | ${arms.map((a) => armLabel[a] || a).join(" | ")} |`);
out.push(`|---|---|${arms.map(() => "---").join("|")}|`);
for (const t of taskIds) {
  const cell = (a) => {
    const rs = rows.filter((r) => r.arm === a && r.task === t);
    if (!rs.length) return "-";
    const df = rs.reduce(
      (s, r) => s + (r.judge ? r.judge.defects_identified.length : r.found.length),
      0
    );
    const dt = rs.reduce((s, r) => s + r.expected_defects, 0);
    const fab = rs.filter(
      (r) =>
        r.provable_fabrications.length ||
        r.facts_fabricated.length ||
        (r.judge && r.judge.fabrications.length)
    ).length;
    const fp = rs.filter((r) => r.judge && r.judge.false_positives.length).length;
    const cost = rs.reduce((s, r) => s + r.cost_usd, 0) / rs.length;
    return `${dt ? `${df}/${dt}` : "n/a"} · fab ${fab}/${rs.length} · fp ${fp}/${rs.length} · ${D(cost)}`;
  };
  out.push(
    `| \`${t}\` | recall · fabrications · false pos · cost | ${arms.map(cell).join(" | ")} |`
  );
}

out.push(`\n## Every fabrication, verbatim\n`);
let any = false;
for (const a of arms) {
  const rs = rows.filter(
    (r) =>
      r.arm === a &&
      (r.provable_fabrications.length ||
        r.facts_fabricated.length ||
        (r.judge && r.judge.fabrications.length))
  );
  if (!rs.length) continue;
  any = true;
  out.push(`\n### ${armLabel[a] || a}\n`);
  for (const r of rs) {
    out.push(`**\`${r.trial}\`**\n`);
    for (const f of r.provable_fabrications)
      out.push(`- access log contradicts: ${f.url} — ${f.why}`);
    for (const f of r.facts_fabricated)
      out.push(`- wrong value for \`${f.id}\`: reported ${f.reported.join(", ")}`);
    for (const f of r.judge?.fabrications || []) out.push(`- judged: ${f.claim} — ${f.why}`);
    out.push("");
  }
}
if (!any) out.push(`None recorded.\n`);

console.log(out.join("\n"));
