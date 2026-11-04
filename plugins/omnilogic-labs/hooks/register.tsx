import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { MailBand, WorkerEngine, WorkerJob } from "../types";
import {
  ARTIFACT_URL,
  MAIL_MAX,
  MAIL_POLL_MS,
  MAIL_RULE,
  deliveredText,
  isSingleOmsg,
  mailArgs,
  parseCount,
  parseHookStart,
  parseRecords,
  questionnaireTitle,
  type MailPaths,
} from "./mail";

// The tool is listed as mcp__<plugin>__<name>; the tool.call matcher below
// spells the full name as a literal so the engine's scan can read it.
const TOOL_NAME = "external_worker";
const ROOT = "/tmp/omnilogic-labs/workers";
const POLL_MS = 1000;
const DEFAULT_TIMEOUT_SEC = 1800;
// A background Bash call is stopped at its `timeout` (10 minutes when left
// out, 2 hours at most), so the job's call passes one a minute past the
// worker's own limit, and that limit stops short of the cap.
const BASH_BG_MAX_MS = 7_200_000;
const MAX_TIMEOUT_SEC = BASH_BG_MAX_MS / 1000 - 60;
const ENGINES: readonly WorkerEngine[] = ["codex", "agy", "fake"];
// none runs the worker unsandboxed: a git worktree's .git lives outside its
// cwd and workers often need the network, so a sandbox breaks commits and tools.
const SANDBOXES = ["none", "workspace-write", "read-only"] as const;
type Sandbox = (typeof SANDBOXES)[number];
const DEFAULT_SANDBOX: Sandbox = "none";
const RUNNER = "omnilogic-labs:external-runner";
// How much of the task a transcript row shows; the job dir keeps all of it.
const TASK_PREVIEW = 80;

const jobs = atom({ plugin: "omnilogic-labs", key: "jobs" } as const, []);

type WorkerInput = {
  task?: unknown;
  engine?: unknown;
  cwd?: unknown;
  model?: unknown;
  effort?: unknown;
  sandbox?: unknown;
  timeoutSec?: unknown;
  resume?: unknown;
};

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_ID = /^[0-9a-f]{8}$/i;

// Single-quote a string for bash.
const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

const optional = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const PANE = "workers";
const TAIL_LINES = 40;

// The job the /workers pane shows; a reload resets it to the newest job.
let selected: string | null = null;

function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

// One short phrase for the last stream line. codex prints item.completed:<type>
// plus the item's text; agy prints {"event":...} objects; anything else is cut raw.
function summarize(line: string): string {
  const cut = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 60);
  if (line === "") return "starting";
  try {
    const ev = JSON.parse(line) as Record<string, unknown>;
    const type = typeof ev.type === "string" ? ev.type : "";
    if (type.startsWith("item.completed")) {
      const item = (ev.item ?? {}) as Record<string, unknown>;
      const text = typeof item.text === "string" ? item.text : "";
      return cut(`${type}:${String(item.type ?? "")} ${text}`);
    }
    if (typeof ev.event === "string") {
      const step = (ev.step_update ?? {}) as Record<string, unknown>;
      const text = typeof step.text_delta === "string" ? step.text_delta : "";
      return cut(`${ev.event} ${text}`);
    }
    if (type !== "") return cut(`${type} ${typeof ev.text === "string" ? ev.text : ""}`);
  } catch {
    // not JSON: fall through to the raw line
  }
  return cut(line);
}

// The one Bash command the external-runner agent runs to follow a job; the
// tool.check hook allows exactly these strings for known jobs.
const watchCommand = (root: string, dir: string) =>
  `bash ${q(`${root}/hooks/watch-worker.sh`)} ${q(dir)}`;

// The plugin files whose change on disk this session would not see until
// /reload-plugins: the agent definition loads once, like this module.
const LOADED_FILES = ["agents/external-runner.md", "hooks/register.tsx", "hooks/watch-worker.sh"];
let loaded: Map<string, string | null> | null = null;

async function snapshot($: EngineInterface): Promise<Map<string, string | null>> {
  const files = new Map<string, string | null>();
  for (const f of LOADED_FILES) files.set(f, await readText($, `${$.plugin.root}/${f}`));
  return files;
}

// A sentence for the tool result when the plugin changed since this session
// loaded it, else "".
async function staleWarning($: EngineInterface): Promise<string> {
  if (loaded === null) return "";
  const now = await snapshot($);
  const changed = LOADED_FILES.filter((f) => now.get(f) !== loaded?.get(f));
  if (changed.length === 0) return "";
  return (
    ` WARNING: omnilogic-labs changed on disk since this session loaded it (${changed.join(", ")}); ` +
    "tell the user to run /reload-plugins so the external-runner agent and this tool match."
  );
}

// Module-local: timers die with a reload, so session.start re-arms them.
const timers = new Map<string, { cancel: () => void }>();

async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path);
  } catch {
    return null;
  }
}

async function patchJob($: EngineInterface, id: string, patch: Partial<WorkerJob>): Promise<void> {
  await update($, jobs, (list) => list.map((j) => (j.id === id ? { ...j, ...patch } : j)));
}

async function addJob($: EngineInterface, job: WorkerJob): Promise<void> {
  await update($, jobs, (list) => [...list, job].slice(-50));
}

function poll($: EngineInterface, id: string): void {
  if (timers.has(id)) return;
  const timer = $.clock.every(POLL_MS, () => {
    void (async () => {
      const job = (await read($, jobs)).find((j) => j.id === id);
      if (job === undefined || job.status !== "running") {
        timer.cancel();
        timers.delete(id);
        return;
      }
      const stream = (await readText($, `${job.dir}/stream.jsonl`)) ?? "";
      const lines = stream.split("\n").filter(Boolean);
      const exitText = await readText($, `${job.dir}/exit`);
      const now = await $.clock.now();
      const exitCode = exitText === null ? null : Number(exitText.trim());

      if (exitCode === null) {
        // A job from a process that died (a resumed session) never writes exit.
        // Past its timeout plus a minute with no exit file, call it stale.
        const staleAfterMs = (job.timeoutSec + 60) * 1000;
        if (now - job.startedAt > staleAfterMs) {
          await patchJob($, id, {
            lines: lines.length,
            lastLine: (lines.at(-1) ?? "").slice(0, 200),
            status: "failed",
            error: "stale: no exit file past the timeout",
            endedAt: now,
          });
          timer.cancel();
          timers.delete(id);
          return;
        }
        await patchJob($, id, {
          lines: lines.length,
          lastLine: (lines.at(-1) ?? "").slice(0, 200),
        });
        return;
      }

      const failed = !Number.isFinite(exitCode) || exitCode !== 0;
      await patchJob($, id, {
        lines: lines.length,
        lastLine: (lines.at(-1) ?? "").slice(0, 200),
        exitCode: Number.isFinite(exitCode) ? exitCode : null,
        status: failed ? "failed" : "done",
        error: failed ? `exit ${exitText?.trim() ?? "?"}` : null,
        endedAt: now,
      });
      timer.cancel();
      timers.delete(id);
      // One wake per job: the native task notification names the background
      // task's output file, which ends with run-worker.sh's cat of last.txt.
      $.ui.toast(
        `${job.engine} job ${id} ${failed ? "failed" : "finished"} (exit ${exitText?.trim() ?? "?"})`
      );
    })();
  });
  timers.set(id, timer);
}

// ---------- omsg mail (pure helpers in mail.ts) ----------

const mailBand = atom(
  { plugin: "omnilogic-labs", key: "mail" } as const,
  {
    owner: 0,
  } as MailBand
);

// What session.start learned, kept per session in the plugin's store (shared
// by every session on the machine) so a reload finds it again.
type MailSession = MailPaths & { ruled: boolean };
const mailKey = (sessionId: string) => `mail.${sessionId}`;

// Module-local: a reload drops them, and session.start arms the timer again.
let mailTimer: { cancel: () => void } | null = null;
let lastNotify: number | null = null;
let lastOwnerNotify: number | null | undefined;

// Runs the plugin's omsg through bash (an extensionless script opens a dialog
// on Windows when run bare). Resolves its output, or null when it cannot run.
async function omsg(
  $: EngineInterface,
  args: readonly string[]
): Promise<{ exitCode: number; stdout: string; stderr: string } | null> {
  try {
    return await $.process.run(["bash", `${$.plugin.root}/bin/omsg`, ...args]);
  } catch {
    return null;
  }
}

async function mtime($: EngineInterface, path: string): Promise<number | null> {
  if (path === "") return null;
  try {
    return (await $.fs.stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

async function mailSession($: EngineInterface): Promise<MailSession | null> {
  const got = (await $.store.get(mailKey(await $.session.id()))) as MailSession | undefined;
  return got !== undefined && typeof got.name === "string" ? got : null;
}

// Hands text to this session: a message wakes it if idle, a note waits for
// the next turn.
async function tell($: EngineInterface, text: string): Promise<void> {
  const sessionId = await $.session.id();
  const sent = await $.session.send({ to: { sessionId }, text }).catch(() => null);
  if (sent?.isDelivered !== true) {
    await $.session.append({ message: { type: "user", content: [{ type: "text", text }] } });
  }
}

async function refreshOwner($: EngineInterface): Promise<void> {
  const ran = await omsg($, ["--as", "owner", "count"]);
  const owner = ran === null || ran.exitCode !== 0 ? 0 : parseCount(ran.stdout);
  await update($, mailBand, () => ({ owner }));
}

// One look: the stats alone unless notify is newer than seen (mail for this
// session) or the owner's notify moved (the band's count).
async function checkMail($: EngineInterface): Promise<void> {
  const me = await mailSession($);
  if (me === null) return;
  const notify = await mtime($, me.notify);
  const seen = await mtime($, me.seen);
  if (notify !== null && notify > (seen ?? -Infinity) && notify !== lastNotify) {
    lastNotify = notify;
    const ran = await omsg($, ["--as", me.name, "read", "--json", "--max", String(MAIL_MAX)]);
    const records = ran === null || ran.exitCode !== 0 ? [] : parseRecords(ran.stdout);
    if (records.length > 0) {
      let more = 0;
      if (records.length >= MAIL_MAX) {
        const left = await omsg($, ["--as", me.name, "count"]);
        more = left === null ? 0 : parseCount(left.stdout);
      }
      await tell($, deliveredText(records, more));
    }
  }
  const owner = await mtime($, me.ownerNotify);
  if (owner !== lastOwnerNotify) {
    lastOwnerNotify = owner;
    await refreshOwner($);
  }
}

const safeCheck = ($: EngineInterface) => checkMail($).catch(() => undefined);

// Registers this session with omsg, tells it the mail rule once, and starts
// looking for mail. Quiet when omsg is missing or fails.
async function mailStart($: EngineInterface): Promise<void> {
  const sessionId = await $.session.id();
  const ran = await omsg($, [
    "hook",
    "start",
    "--host",
    "claude",
    "--sid",
    sessionId,
    "--cwd",
    await $.session.root(),
  ]);
  const paths = ran === null || ran.exitCode !== 0 ? null : parseHookStart(ran.stdout);
  if (paths === null) return;
  const before = await mailSession($);
  const me: MailSession = { ...paths, ruled: before?.ruled === true };
  if (!me.ruled) {
    await $.session.append({
      message: { type: "user", content: [{ type: "text", text: MAIL_RULE }] },
    });
    me.ruled = true;
  }
  await $.store.set(mailKey(sessionId), me);
  if (mailTimer === null) mailTimer = $.clock.every(MAIL_POLL_MS, () => void safeCheck($));
  await safeCheck($);
}

// The band line for the owner's unread mail, or null at zero.
async function mailLine($: EngineInterface): Promise<string | null> {
  const { owner } = await read($, mailBand);
  return owner > 0 ? `Mail: ${owner} for you (/mail)` : null;
}

// Each running codex or agy job gets its own omsg name; fake jobs get none.
const workerMailName = (engine: WorkerEngine, id: string) =>
  engine === "fake" ? "" : `${engine}-${id}`;

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const started = await next(e);
    loaded = await snapshot($);
    await $.tool.register({
      name: TOOL_NAME,
      description:
        `Do not call this from the main conversation: dispatch the ${RUNNER} agent instead, ` +
        "which calls it, follows the job as a visible subagent and replies with the final " +
        "message. Starts an external coding worker (codex exec, agy -p, or the harmless fake " +
        "engine) on a self-contained task, in the background, and returns a job id, output " +
        "directory and a Watch command that follows the job until it ends.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "The full, self-contained task for the worker." },
          engine: {
            type: "string",
            enum: ["codex", "agy", "fake"],
            description: "Which worker runs the task. fake is a harmless stand-in for testing.",
          },
          cwd: {
            type: "string",
            description:
              "Absolute directory the worker runs in (for example a git worktree). Defaults to the session's project root.",
          },
          model: { type: "string", description: "Optional model override for the engine." },
          effort: {
            type: "string",
            description: "Optional reasoning effort (codex model_reasoning_effort, agy --effort).",
          },
          sandbox: {
            type: "string",
            enum: [...SANDBOXES],
            description:
              `Optional sandbox (default ${DEFAULT_SANDBOX}). none runs unsandboxed with no approval prompts, so ` +
              "the worker can commit in a worktree and reach the network; workspace-write limits writes to cwd; " +
              "read-only allows no writes.",
          },
          timeoutSec: {
            type: "number",
            description: `Optional wall-clock limit in seconds (default ${DEFAULT_TIMEOUT_SEC}, at most ${MAX_TIMEOUT_SEC}).`,
          },
          resume: {
            type: "string",
            description:
              "codex only: continue an earlier codex session instead of starting a new one, with task as " +
              "the next prompt. Pass its thread id, or the 8-character id of an earlier external_worker " +
              "job (which also supplies its cwd when cwd is not given).",
          },
        },
        required: ["task", "engine"],
      },
      isDeferred: false,
    });
    await $.command.register({
      name: "workers",
      description: "Show external worker jobs and tail the newest one's output",
      argumentHint: "[job id]",
    });
    for (const job of await read($, jobs)) if (job.status === "running") poll($, job.id);
    await $.command.register({
      name: "mail",
      description: "Read the owner's omsg mail, or reply and send as the owner",
      argumentHint: "[reply <id> <text> | send <to> <text>]",
    });
    // omsg starts Bun; the first prompt does not wait on it.
    void mailStart($).catch(() => undefined);
    return started;
  });

  on("command.run", { command: "workers" }, async ($, e) => {
    const list = await read($, jobs);
    const arg = e.args.trim();
    if (arg !== "" && !list.some((j) => j.id === arg)) {
      return { text: `No worker job ${arg}. Jobs: ${list.map((j) => j.id).join(", ") || "none"}.` };
    }
    selected = arg === "" ? (list.at(-1)?.id ?? null) : arg;
    await $.ui.open({ id: PANE, title: "Workers" });
    return { text: "Workers pane opened." };
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const running = (await read($, jobs)).filter((j) => j.status === "running");
    const mail = await mailLine($);
    if (e.props.hasSurvey || (running.length === 0 && mail === null)) return next(e);
    const now = await $.clock.now();
    const { Box, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        {mail !== null && <Text dimColor>{mail}</Text>}
        {running.map((j) => (
          <Text key={j.id} dimColor>
            {j.engine} {j.id} {mmss(now - j.startedAt)} {summarize(j.lastLine)}
          </Text>
        ))}
      </Box>
    );
  });

  on("ui.render", { component: "Pane", requestId: "workers" }, async ($, e) => {
    const list = await read($, jobs);
    const { Box, Text } = $.ui.resolve(e);
    const job = list.find((j) => j.id === selected) ?? list.at(-1);
    if (job === undefined) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No worker jobs yet.</Text>
        </Box>
      );
    }
    const stream = (await readText($, `${job.dir}/stream.jsonl`)) ?? "";
    const room = Math.max(1, Math.min(TAIL_LINES, (e.viewport?.rows ?? 24) - 5));
    const tail = stream.split("\n").filter(Boolean).slice(-room);
    const now = await $.clock.now();
    const code = job.status === "running" ? "" : ` (exit ${job.exitCode ?? "?"})`;
    return (
      <Box flexDirection="column">
        <Text>
          {job.engine} {job.id} {job.status}
          {code} {mmss((job.endedAt ?? now) - job.startedAt)}
        </Text>
        <Text dimColor>{job.task}</Text>
        {list.length > 1 && (
          <Text dimColor>jobs: {list.map((j) => j.id).join(" ")} (/workers &lt;id&gt;)</Text>
        )}
        {tail.length === 0 && <Text dimColor>No output yet.</Text>}
        {tail.map((l, i) => (
          <Text key={`${job.lines}-${i}`} dimColor>
            {l.slice(0, 200)}
          </Text>
        ))}
      </Box>
    );
  });

  // Show a short task on the call's transcript row, not the whole prompt.
  on("ui.render", { component: "ToolUse" }, (_$, e, next) => {
    const input = (e.props.input ?? {}) as WorkerInput;
    if (e.props.tool !== `mcp__omnilogic-labs__${TOOL_NAME}`) return next(e);
    if (typeof input.task !== "string" || input.task.length <= TASK_PREVIEW) return next(e);
    const task = `${input.task.replace(/\s+/g, " ").slice(0, TASK_PREVIEW)}... (${input.task.length} chars)`;
    return next({ ...e, props: { ...e.props, input: { ...input, task } } });
  });

  // The external-runner agent follows its job with the Watch command; allow
  // exactly that command for a known job, from a subagent, without a prompt.
  // A single omsg call that would ask is allowed too.
  on("tool.check", { tool: "Bash" }, async ($, e, next) => {
    const command = (e.input as { command?: unknown } | undefined)?.command;
    if (typeof command !== "string") return next(e);
    const known =
      e.agentId !== undefined &&
      (await read($, jobs)).some((j) => watchCommand($.plugin.root, j.dir) === command);
    if (known) return { decision: "allow", reason: "external_worker Watch command" };
    const decided = await next(e);
    return decided.decision === "ask" && isSingleOmsg(command)
      ? { ...decided, decision: "allow", reason: "a single omsg call" }
      : decided;
  });

  on("tool.call", { tool: "mcp__omnilogic-labs__external_worker" }, async ($, e, next) => {
    // The main loop's own call runs a job nobody can watch; send it to the agent.
    if (e.agentId === undefined && next.origin.plugin === "engine") {
      return {
        deny:
          `Do not call external_worker from the main conversation. Dispatch the ${RUNNER} ` +
          "agent with engine, task and cwd (and model, effort, sandbox or timeoutSec if needed); it " +
          "starts the job, shows its progress, and replies with the final message.",
      };
    }
    const input = e as unknown as WorkerInput;
    const task = typeof input.task === "string" ? input.task : "";
    const engine = input.engine as WorkerEngine;
    if (task.trim() === "") return { deny: "external_worker needs a non-empty task." };
    if (!ENGINES.includes(engine)) {
      return { deny: `external_worker engine must be one of ${ENGINES.join(", ")}.` };
    }
    const sandbox = (optional(input.sandbox) || DEFAULT_SANDBOX) as Sandbox;
    if (!SANDBOXES.includes(sandbox)) {
      return { deny: `external_worker sandbox must be one of ${SANDBOXES.join(", ")}.` };
    }
    const model = optional(input.model);
    const effort = optional(input.effort);
    let cwd = optional(input.cwd);
    let resume = optional(input.resume);
    if (resume !== "") {
      if (engine !== "codex")
        return { deny: "external_worker resume works with engine codex only." };
      if (JOB_ID.test(resume)) {
        // An earlier job, from any session: its thread id is in the first
        // stream line, its cwd on the second line of params.
        const found = await $.process.run([
          "bash",
          "-c",
          'for d in "$1"/*/"$2"; do [ -f "$d/params" ] || continue; sed -n 2p "$d/params"; ' +
            'grep -m1 -o \'"thread_id":"[^"]*"\' "$d/stream.jsonl" | cut -d\'"\' -f4; exit 0; done; exit 1',
          "_",
          ROOT,
          resume,
        ]);
        const [jobCwd = "", thread = ""] = found.stdout.split("\n").map((l) => l.trim());
        if (found.exitCode !== 0 || !THREAD_ID.test(thread)) {
          return { deny: `external_worker found no codex thread for job ${resume} under ${ROOT}.` };
        }
        resume = thread;
        cwd ||= jobCwd;
      } else if (!THREAD_ID.test(resume)) {
        return {
          deny: "external_worker resume must be a codex thread id or an 8-character job id.",
        };
      }
    }
    cwd ||= await $.session.root();
    const timeoutSec =
      typeof input.timeoutSec === "number" && input.timeoutSec > 0
        ? Math.min(Math.floor(input.timeoutSec), MAX_TIMEOUT_SEC)
        : DEFAULT_TIMEOUT_SEC;
    if ([cwd, model, effort].some((v) => v.includes("\n"))) {
      return { deny: "external_worker cwd, model and effort must be single lines." };
    }

    const sessionId = await $.session.id();
    const id = crypto.randomUUID().slice(0, 8);
    let dir = `${ROOT}/${sessionId}/${id}`;
    const mailName = workerMailName(engine, id);
    const mailLine = mailName === "" ? "" : `\nMail: ${mailName}`;

    // Job dirs hold task text, which may carry secrets: create them 700.
    // bash prints the dir back as the path to use from here on. On Windows,
    // Git Bash maps /tmp to %TEMP% while $.fs maps it to C:	mp, so the job
    // files and run-worker.sh would see two different directories; pwd -W
    // gives C:/Users/.../Temp/..., which both read. Elsewhere it is plain pwd.
    const made = await $.process.run([
      "bash",
      "-c",
      'umask 077 && mkdir -p -- "$1" && cd -- "$1" && { pwd -W 2> /dev/null || pwd; }',
      "_",
      dir,
    ]);
    if (made.exitCode !== 0) {
      return { deny: `external_worker could not create ${dir}: ${made.stderr.trim()}` };
    }
    dir = made.stdout.trim() || dir;

    const startedAt = await $.clock.now();
    const job: WorkerJob = {
      id,
      sessionId,
      engine,
      cwd,
      task: task.slice(0, 200),
      dir,
      taskId: null,
      timeoutSec,
      lines: 0,
      lastLine: "",
      status: "running",
      exitCode: null,
      error: null,
      startedAt,
      endedAt: null,
    };

    await $.fs.write(`${dir}/task.txt`, task);
    await $.fs.write(
      `${dir}/params`,
      [engine, cwd, String(timeoutSec), model, effort, sandbox, resume, mailName].join("\n") + "\n"
    );

    // A missing cwd fails the job here, without spending a background task.
    let cwdOk = false;
    try {
      cwdOk = (await $.fs.stat(cwd)).kind === "dir";
    } catch {
      cwdOk = false;
    }
    if (!cwdOk) {
      const error = `cwd does not exist or is not a directory: ${cwd}`;
      await $.fs.write(`${dir}/stderr.log`, `run-worker: ${error}\n`);
      await $.fs.write(`${dir}/last.txt`, `(no final message; exit 2)\n${error}\n`);
      await $.fs.write(`${dir}/exit`, "2\n");
      await addJob($, { ...job, status: "failed", exitCode: 2, error, endedAt: startedAt });
      return { result: `external_worker job ${id} failed: ${error}. Output: ${dir}.` };
    }

    const ran = await $.tool.call({
      tool: "Bash",
      command: `bash ${q(`${$.plugin.root}/hooks/run-worker.sh`)} ${q(dir)}`,
      description: `${engine} worker job ${id}`,
      run_in_background: true,
      timeout: (timeoutSec + 60) * 1000,
    });
    if (ran.deny !== undefined || ran.isError) {
      const error =
        ran.deny !== undefined ? `Bash call denied: ${ran.deny}` : `Bash call failed: ${ran.text}`;
      await addJob($, { ...job, status: "failed", error, endedAt: startedAt });
      return ran.deny !== undefined
        ? { deny: ran.deny }
        : { result: `external_worker job ${id} ${error}` };
    }
    const result = ran.result as { backgroundTaskId?: string } | undefined;
    const taskId = result?.backgroundTaskId ?? null;
    await addJob($, { ...job, taskId });
    poll($, id);

    return {
      result:
        `Started ${engine} job ${id} as background task ${taskId ?? "(none)"} in ${cwd}. ` +
        `Output dir: ${dir}.${await staleWarning($)} Now run the Watch command with Bash. It returns ` +
        `about once a minute: after each RUNNING, write one or two sentences on what the worker is doing, ` +
        `then run it again; reply only once it prints DONE or STALE. ` +
        `Watch: ${watchCommand($.plugin.root, dir)}${mailLine}`,
    };
  }).catch(() => ({
    deny: "external_worker failed to start the job (hook error or timeout); see the debug log.",
  }));

  // ---------- omsg mail ----------

  on("command.run", { command: "mail" }, async ($, e) => {
    const args = mailArgs(e.args);
    if (typeof args === "string") return { text: args };
    const ran = await omsg($, args);
    if (ran === null)
      return { text: "omsg could not run; is the omnilogic-labs plugin installed?" };
    await refreshOwner($).catch(() => undefined);
    const out = ran.stdout.trim();
    if (ran.exitCode !== 0)
      return { text: `omsg failed (exit ${ran.exitCode}): ${ran.stderr.trim() || out}` };
    return { text: out || (args[2] === "read" ? "No mail." : "Sent.") };
  });

  on("session.end", async ($, e, next) => {
    mailTimer?.cancel();
    mailTimer = null;
    await omsg($, ["hook", "end", "--host", "claude", "--sid", e.sessionId]);
    await $.store.delete(mailKey(e.sessionId)).catch(() => undefined);
    return next(e);
  });

  // A published questionnaire is mailed to the owner with its link.
  on("tool.call", { tool: "Artifact" }, async ($, e, next) => {
    const res = await next(e);
    const input = e as unknown as { action?: string; file_path?: unknown; asset?: boolean };
    const file = typeof input.file_path === "string" ? input.file_path : "";
    if (res.deny !== undefined || res.isError || input.asset === true) return res;
    if ((input.action ?? "publish") !== "publish" || !file.endsWith(".html")) return res;
    void (async () => {
      const me = await mailSession($);
      if (me === null) return;
      const title = questionnaireTitle(await $.fs.read(file));
      const url = ARTIFACT_URL.exec(res.text ?? JSON.stringify(res.result ?? ""))?.[0];
      if (title === null || url === undefined) return;
      await omsg($, ["--as", me.name, "send", "owner", `Answer: ${title} ${url}`]);
    })().catch(() => undefined);
    return res;
  });
};
