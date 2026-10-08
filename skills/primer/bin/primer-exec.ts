#!/usr/bin/env -S npx tsx
/*
 * primer-exec: the canonical primer task runner.
 *
 * Runs docs/init/NN-slug.md task files as isolated `claude -p` invocations, in
 * dependency order, applying four verification gates and minting an idempotent
 * `[task-complete] NN-slug` marker commit per task. Replaces the per-project
 * run-tasks.ts / run-tasks.sh scripts and fixes the bugs they accumulated:
 *
 *  - watchdog: single re-armed idle timer disabled on the first result event
 *    (success OR error), an explicit post-result SIGTERM -> SIGKILL escalation,
 *    and an `exited` flag instead of the unreliable `child.killed` guard. This
 *    is the bug that made a downstream fork delete hang-detection entirely.
 *  - stream parsing: readline (no manual buffer, no trailing-partial double
 *    write to the same file).
 *  - SIGINT: an `interrupted` flag that dominates at exit so Ctrl-C actually
 *    stops the run; a second Ctrl-C escalates to SIGKILL.
 *  - gates: clean tree, build, the task's acceptance command, typecheck, with
 *    no vacuous-pass whitelist; acceptance comes from frontmatter.
 *  - idempotency: marker minted by the runner, HEAD-pinned git log, argument
 *    arrays (never shell-string interpolation), a zero-changes guard so a
 *    no-op subagent cannot mint a false completion.
 *  - discovery: numeric sort (correct past 99 tasks) and a topological sort
 *    over declared `deps`.
 *
 * Runs under tsx (`npx tsx primer-exec.ts ...`) or bun (`bun primer-exec.ts ...`).
 * Run it from the target repo root (cwd = the project being built).
 *
 * Usage:
 *   primer-exec [options]
 *     --task-dir <dir>     task directory (default: docs/init)
 *     --from <NN>          start at task number NN (inclusive)
 *     --only <NN>          run only task NN (implies --force for that task)
 *     --list               list tasks with completion and dependency state, then exit
 *     --dry-run            show what would run without spawning anything
 *     --force              re-run tasks even if their marker exists
 *     --resume             checkpoint a dirty tree and surface recent commits to the agent
 *     --idle-timeout <s>   idle watchdog seconds, 0 disables (default: 600)
 *     --model <name>       claude model (default: opus)
 *     --effort <level>     claude effort (default: max)
 *     --api-billing        use ANTHROPIC_API_KEY billing instead of the subscription default
 *     --help               show this help
 */

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, existsSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const ROOT = process.cwd();
const POST_RESULT_SOFT_MS = 30_000;
const POST_RESULT_HARD_MS = 10_000;
const DOUBLE_SIGINT_MS = 2_000;

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

interface Opts {
  taskDir: string;
  from: number | null;
  only: number | null;
  list: boolean;
  dryRun: boolean;
  force: boolean;
  resume: boolean;
  idleMs: number;
  model: string;
  effort: string;
  apiBilling: boolean;
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    taskDir: "docs/init",
    from: null,
    only: null,
    list: false,
    dryRun: false,
    force: false,
    resume: false,
    idleMs: 600_000,
    model: "opus",
    effort: "max",
    apiBilling: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--task-dir":
        o.taskDir = next();
        break;
      case "--from":
        o.from = parseInt(next(), 10);
        break;
      case "--only":
        o.only = parseInt(next(), 10);
        break;
      case "--list":
        o.list = true;
        break;
      case "--dry-run":
        o.dryRun = true;
        break;
      case "--force":
        o.force = true;
        break;
      case "--resume":
        o.resume = true;
        break;
      case "--idle-timeout":
        o.idleMs = Math.max(0, parseInt(next(), 10) * 1000);
        break;
      case "--model":
        o.model = next();
        break;
      case "--effort":
        o.effort = next();
        break;
      case "--api-billing":
        o.apiBilling = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        err(`unknown option: ${a}`);
        printHelp();
        process.exit(2);
    }
  }
  return o;
}

function printHelp(): void {
  err(
    readFileSync(new URL(import.meta.url))
      .toString()
      .split("\n")
      .filter((l) => l.startsWith(" * ") || l.startsWith(" *   ") || l.startsWith(" *     "))
      .map((l) => l.replace(/^ \* ?/, ""))
      .join("\n")
  );
}

// ---------------------------------------------------------------------------
// Logging: human output to stderr, machine state events to stdout
// ---------------------------------------------------------------------------

function err(msg: string): void {
  process.stderr.write(msg + "\n");
}
function emit(event: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

// ---------------------------------------------------------------------------
// git helpers (argument arrays only, never shell-string interpolation)
// ---------------------------------------------------------------------------

function git(args: string[]): { code: number; out: string } {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return { code: r.status ?? 1, out: (r.stdout ?? "").trim() };
}

function headSha(): string {
  return git(["rev-parse", "HEAD"]).out;
}
function workingTreeClean(): boolean {
  return git(["status", "--porcelain"]).out === "";
}

function completedMarkers(): Set<string> {
  // HEAD-pinned, not --all, so a marker on another branch does not count.
  const { code, out } = git(["log", "--pretty=%s", "HEAD"]);
  const set = new Set<string>();
  if (code !== 0) return set;
  for (const line of out.split("\n")) {
    const m = line.match(/^\[task-complete\]\s+(\S+)\s*$/);
    if (m) set.add(m[1]);
  }
  return set;
}

function changedFilesSince(sha: string): string[] {
  const { out } = git(["diff", "--name-only", `${sha}`, "HEAD"]);
  return out ? out.split("\n").filter(Boolean) : [];
}

function commitsSinceLastMarker(): string[] {
  const { out } = git(["log", "--pretty=%s", "-n", "100", "HEAD"]);
  const lines = out ? out.split("\n") : [];
  const idx = lines.findIndex((l) => /^\[task-complete\]\s+\S+/.test(l));
  return idx < 0 ? lines : lines.slice(0, idx);
}

// ---------------------------------------------------------------------------
// Task discovery, frontmatter, topological sort
// ---------------------------------------------------------------------------

interface Task {
  slug: string; // NN-rest, the filename without .md
  id: string; // frontmatter id, else slug; the marker key
  num: number;
  path: string;
  body: string; // task content with frontmatter stripped
  deps: string[];
  touches: string[];
  acceptance: string | null;
  allowEmpty: boolean;
}

function parseFrontmatter(raw: string): { fm: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---")) return { fm: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { fm: {}, body: raw };
  const block = raw.slice(3, end).trim();
  const body = raw.slice(raw.indexOf("\n", end + 1) + 1);
  const fm: Record<string, unknown> = {};
  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (val === "|" || val === ">") {
      // block scalar: gather subsequent more-indented lines
      const buf: string[] = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
        buf.push(lines[++i].replace(/^\s{1,}/, ""));
      }
      fm[key] = buf.join("\n");
    } else if (val.startsWith("[") && val.endsWith("]")) {
      fm[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      fm[key] = val.replace(/^["']|["']$/g, "");
    }
  }
  return { fm, body };
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return [v];
  return [];
}

function discoverTasks(taskDir: string): Task[] {
  const dir = join(ROOT, taskDir);
  if (!existsSync(dir)) {
    err(`task directory not found: ${dir}`);
    process.exit(2);
  }
  const files = readdirSync(dir).filter((n) => /^\d{2,}[-_].+\.md$/.test(n));
  const tasks = files.map((name): Task => {
    const slug = name.replace(/\.md$/, "");
    const num = parseInt(name.match(/^(\d+)/)![1], 10);
    const raw = readFileSync(join(dir, name), "utf8");
    const { fm, body } = parseFrontmatter(raw);
    const accFm = typeof fm.acceptance === "string" ? fm.acceptance.trim() : null;
    return {
      slug,
      id: typeof fm.id === "string" && fm.id ? fm.id : slug,
      num,
      path: join(dir, name),
      body,
      deps: asStringArray(fm.deps),
      touches: asStringArray(fm.touches),
      acceptance: accFm || extractAcceptanceFromBody(body),
      allowEmpty:
        fm["allow-empty"] === "true" || fm.allowEmpty === "true" || fm["allow-empty"] === true,
    };
  });
  // numeric sort, correct past 99
  tasks.sort((a, b) => a.num - b.num || a.slug.localeCompare(b.slug));
  return tasks;
}

// Fallback acceptance extraction: every fenced block under "## Acceptance",
// concatenated. No command whitelist (that produced vacuous passes); we run
// what the task declares and let it fail loudly if it is wrong.
function extractAcceptanceFromBody(body: string): string | null {
  const idx = body.search(/^##\s+Acceptance/im);
  if (idx < 0) return null;
  const after = body.slice(idx);
  const nextSection = after.slice(1).search(/^##\s/m);
  const section = nextSection > 0 ? after.slice(0, nextSection + 1) : after;
  const blocks = [...section.matchAll(/```(?:bash|sh|shell)?\n([\s\S]*?)```/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  return blocks.length ? blocks.join("\n") : null;
}

function resolveDep(dep: string, tasks: Task[]): Task | null {
  return (
    tasks.find((t) => t.id === dep || t.slug === dep) ??
    tasks.find(
      (t) => t.slug.startsWith(dep) || String(t.num).padStart(2, "0") === dep.padStart(2, "0")
    ) ??
    null
  );
}

function topoSort(tasks: Task[]): Task[] {
  const ordered: Task[] = [];
  const placed = new Set<string>();
  let guard = 0;
  const remaining = [...tasks];
  while (remaining.length && guard++ < tasks.length + 1) {
    const ready = remaining.filter((t) =>
      t.deps.every((d) => {
        const dep = resolveDep(d, tasks);
        if (!dep) {
          err(`task ${t.slug}: unknown dep "${d}"`);
          process.exit(2);
        }
        return placed.has(dep.slug);
      })
    );
    if (ready.length === 0) {
      err(`dependency cycle among: ${remaining.map((t) => t.slug).join(", ")}`);
      process.exit(2);
    }
    // stable: keep numeric order within a level
    ready.sort((a, b) => a.num - b.num);
    for (const t of ready) {
      ordered.push(t);
      placed.add(t.slug);
      remaining.splice(remaining.indexOf(t), 1);
    }
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Build / typecheck auto-detection by lockfile
// ---------------------------------------------------------------------------

function detectPm(): "bun" | "pnpm" | "yarn" | "npm" {
  if (existsSync(join(ROOT, "bun.lock")) || existsSync(join(ROOT, "bun.lockb"))) return "bun";
  if (existsSync(join(ROOT, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(ROOT, "yarn.lock"))) return "yarn";
  return "npm";
}

function pkgScripts(): Record<string, string> {
  const p = join(ROOT, "package.json");
  if (!existsSync(p)) return {};
  try {
    return (JSON.parse(readFileSync(p, "utf8")).scripts ?? {}) as Record<string, string>;
  } catch {
    return {};
  }
}

function buildCmd(): string[] | null {
  const pm = detectPm();
  if (pkgScripts().build) return [pm, "run", "build"];
  return null;
}

function typecheckCmd(): string[] | null {
  if (!existsSync(join(ROOT, "tsconfig.json"))) return null;
  const pm = detectPm();
  if (pm === "bun") return ["bunx", "tsc", "--noEmit"];
  if (pm === "pnpm") return ["pnpm", "exec", "tsc", "--noEmit"];
  if (pm === "yarn") return ["yarn", "tsc", "--noEmit"];
  return ["npx", "tsc", "--noEmit"];
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

function runCmd(name: string, cmd: string, args: string[]): boolean {
  err(`  gate: ${name} (${cmd} ${args.join(" ")})`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: ["ignore", 2, 2] });
  if (r.status === 0) return true;
  err(`  gate failed: ${name}`);
  return false;
}

function runShell(name: string, script: string): boolean {
  err(`  gate: ${name}`);
  const r = spawnSync("bash", ["-eo", "pipefail", "-c", script], {
    cwd: ROOT,
    stdio: ["ignore", 2, 2],
  });
  if (r.status === 0) return true;
  err(`  gate failed: ${name}`);
  return false;
}

// ---------------------------------------------------------------------------
// Subagent execution with a correct watchdog and signal handling
// ---------------------------------------------------------------------------

const PREAMBLE = `You are executing one task from the project's task directory. Read CLAUDE.md and docs/init.md first for project context and the rules that apply to every task. Then complete exactly the task below: do the work, run its acceptance command yourself, and commit your own changes with a short imperative subject. Do NOT write a [task-complete] marker commit; the runner mints that after it verifies your work. Look up current library versions and docs via the context7 MCP; never pin a version from memory. No em dashes or en dashes. Do not run a long-lived foreground command (no dev server in the foreground): background it, capture the PID, run your check, then kill the PID. When finished, exit; do not loop.\n\n---\n\n`;

let interrupted = false;
let lastSigint = 0;

interface RunResult {
  ok: boolean;
  reason?: string;
}

function runSubagent(task: Task, opts: Opts, extraContext: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const logDir = join(ROOT, "logs", "run-tasks");
    mkdirSync(logDir, { recursive: true });
    const logStream = createWriteStream(join(logDir, `${task.slug}.jsonl`), { flags: "a" });

    const prompt = PREAMBLE + extraContext + `Task file: ${task.path}\n\n` + task.body;

    const child = spawn(
      "claude",
      [
        "-p",
        "--model",
        opts.model,
        "--effort",
        opts.effort,
        "--dangerously-skip-permissions",
        "--verbose",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
      ],
      {
        cwd: ROOT,
        env: { ...process.env, ...(opts.apiBilling ? {} : { ANTHROPIC_API_KEY: "" }) },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    child.stdin.write(prompt);
    child.stdin.end();

    let exited = false;
    let sawResult = false;
    let idleKilled = false;
    let idleTimer: NodeJS.Timeout | null = null;
    let softTimer: NodeJS.Timeout | null = null;
    let hardTimer: NodeJS.Timeout | null = null;

    const clearAll = () => {
      for (const t of [idleTimer, softTimer, hardTimer]) if (t) clearTimeout(t);
      idleTimer = softTimer = hardTimer = null;
    };

    const armIdle = () => {
      if (opts.idleMs === 0 || sawResult || exited) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (exited) return;
        idleKilled = true;
        err(`  idle watchdog: no output for ${opts.idleMs / 1000}s, terminating`);
        if (!exited) child.kill("SIGTERM");
        hardTimer = setTimeout(() => {
          if (!exited) child.kill("SIGKILL");
        }, POST_RESULT_HARD_MS);
      }, opts.idleMs);
    };

    // Any byte from either stream counts as activity.
    const onActivity = () => {
      if (!sawResult) armIdle();
    };

    const armPostResult = () => {
      // result seen: stop idle watching, escalate teardown if the child lingers.
      sawResult = true;
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      softTimer = setTimeout(() => {
        if (exited) return;
        if (!exited) child.kill("SIGTERM");
        hardTimer = setTimeout(() => {
          if (!exited) child.kill("SIGKILL");
        }, POST_RESULT_HARD_MS);
      }, POST_RESULT_SOFT_MS);
    };

    // readline handles partial lines and the trailing flush correctly.
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      onActivity();
      if (!line) return;
      logStream.write(line + "\n");
      try {
        const evt = JSON.parse(line);
        if (evt?.type === "result") armPostResult();
      } catch {
        /* partial / non-json line */
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      onActivity();
      logStream.write(chunk);
    });

    const onSigint = () => {
      const now = Date.now();
      if (interrupted && now - lastSigint < DOUBLE_SIGINT_MS) {
        err("  second interrupt: SIGKILL");
        if (!exited) child.kill("SIGKILL");
        return;
      }
      interrupted = true;
      lastSigint = now;
      err("  interrupt: stopping after this task, sending SIGINT to child (Ctrl-C again to force)");
      if (!exited) child.kill("SIGINT");
    };
    process.on("SIGINT", onSigint);

    armIdle();

    child.on("close", (code, signal) => {
      exited = true;
      clearAll();
      process.off("SIGINT", onSigint);
      rl.close();
      logStream.end();
      if (interrupted) return resolve({ ok: false, reason: "interrupted" });
      if (idleKilled) return resolve({ ok: false, reason: "idle_timeout" });
      if (signal) return resolve({ ok: false, reason: `killed by ${signal}` });
      if (code !== 0) return resolve({ ok: false, reason: `subagent exited ${code}` });
      if (!sawResult) return resolve({ ok: false, reason: "no result event in stream" });
      resolve({ ok: true });
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const all = topoSort(discoverTasks(opts.taskDir));
  const done = completedMarkers();

  if (opts.list) {
    for (const t of all) {
      const isDone = done.has(t.id) || done.has(t.slug);
      const depsOk = t.deps.every((d) => {
        const dep = resolveDep(d, all);
        return dep && (done.has(dep.id) || done.has(dep.slug));
      });
      err(
        `${isDone ? "[x]" : "[ ]"} ${t.slug}${t.deps.length ? `  deps:${depsOk ? "ok" : "PENDING"}` : ""}`
      );
    }
    return;
  }

  const selected = all.filter((t) => {
    if (opts.only != null) return t.num === opts.only;
    if (opts.from != null && t.num < opts.from) return false;
    return true;
  });
  const forceAll = opts.force || opts.only != null;

  for (const task of selected) {
    if (interrupted) break;
    const isDone = done.has(task.id) || done.has(task.slug);
    if (isDone && !forceAll) {
      err(`[${task.slug}] complete, skipping`);
      continue;
    }

    // dependency guard (force does not bypass missing deps)
    const missing = task.deps.filter((d) => {
      const dep = resolveDep(d, all);
      return !(dep && (done.has(dep.id) || done.has(dep.slug)));
    });
    if (missing.length) {
      err(`[${task.slug}] blocked: deps not complete: ${missing.join(", ")}`);
      emit({ event: "task_blocked", slug: task.slug, missing });
      break;
    }

    if (opts.dryRun) {
      err(`[${task.slug}] would run`);
      emit({ event: "task_dryrun", slug: task.slug });
      continue;
    }

    let extraContext = "";
    if (opts.resume) {
      if (!workingTreeClean()) {
        git(["add", "-A"]);
        git(["commit", "--allow-empty", "-m", `wip(primer-exec): checkpoint before ${task.slug}`]);
        err(`[${task.slug}] resume: checkpointed dirty tree`);
      }
      const recent = commitsSinceLastMarker();
      if (recent.length)
        extraContext = `Recent commits since the last completed task (you may be resuming partial work; finish it, do not redo it):\n${recent.map((c) => `  - ${c}`).join("\n")}\n\n`;
    }

    err(`[${task.slug}] running...`);
    emit({ event: "task_start", slug: task.slug });
    const shaBefore = headSha();
    const result = await runSubagent(task, opts, extraContext);

    if (interrupted) {
      err(`[${task.slug}] interrupted`);
      emit({ event: "task_interrupted", slug: task.slug });
      break;
    }
    if (!result.ok) {
      err(`[${task.slug}] FAILED (${result.reason})`);
      emit({ event: "task_fail", slug: task.slug, reason: result.reason });
      break;
    }

    // Gate 1: clean tree (the subagent must have committed its own work)
    if (!workingTreeClean()) {
      err(`[${task.slug}] FAILED gate: working tree not clean`);
      emit({ event: "gate_fail", slug: task.slug, gate: "clean-tree" });
      break;
    }

    // Gate 2: build (auto-detected; skipped if none)
    const build = buildCmd();
    if (build) {
      if (!runCmd("build", build[0], build.slice(1))) {
        emit({ event: "gate_fail", slug: task.slug, gate: "build" });
        break;
      }
    } else err("  gate: build (skipped, no build script)");

    // Gate 3: acceptance command from the task file
    if (task.acceptance) {
      if (!runShell("acceptance", task.acceptance)) {
        emit({ event: "gate_fail", slug: task.slug, gate: "acceptance" });
        break;
      }
    } else err("  gate: acceptance (skipped, task declares none)");

    // Gate 4: typecheck (auto-detected; skipped if no tsconfig)
    const tc = typecheckCmd();
    if (tc) {
      if (!runCmd("typecheck", tc[0], tc.slice(1))) {
        emit({ event: "gate_fail", slug: task.slug, gate: "typecheck" });
        break;
      }
    } else err("  gate: typecheck (skipped, no tsconfig.json)");

    // Zero-changes guard: a no-op subagent must not mint a false completion.
    const changed = changedFilesSince(shaBefore);
    if (changed.length === 0 && !task.allowEmpty) {
      err(
        `[${task.slug}] FAILED: no files changed (set allow-empty: true in frontmatter if intended)`
      );
      emit({ event: "gate_fail", slug: task.slug, gate: "zero-changes" });
      break;
    }

    // Mint the marker (runner-owned, argument array, allow-empty).
    const body = changed.length
      ? `files:\n${changed.map((f) => ` - ${f}`).join("\n")}`
      : "no file changes (allow-empty)";
    git(["commit", "--allow-empty", "-m", `[task-complete] ${task.id}`, "-m", body]);
    done.add(task.id);
    err(`[${task.slug}] verified and marked complete`);
    emit({ event: "task_done", slug: task.slug, changed: changed.length });
  }

  emit({ event: "run_done", interrupted });
  if (interrupted) process.exit(130);
}

main().catch((e) => {
  err(`primer-exec crashed: ${e?.stack ?? e}`);
  process.exit(1);
});
