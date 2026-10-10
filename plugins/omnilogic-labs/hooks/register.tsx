import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { InboxBand, WorkerEngine, WorkerJob } from "../types";
import {
  ARTIFACT_URL,
  COLLECTION,
  KINDS,
  LABELS_KEY,
  INBOX_POLL_MS,
  PRUNE_MS,
  SEEN_KEY,
  STATES,
  TOOL_NAME as INBOX_TOOL,
  URL_KEY,
  describe,
  field,
  parseDocs,
  parseLinks,
  questionnaireTitle,
  str,
  type InboxInput,
  type Item,
} from "./inbox";

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
};

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

// ---------- owner inbox (pure helpers in inbox.ts) ----------

const band = atom(
  { plugin: "omnilogic-labs", key: "inbox" } as const,
  {
    url: "",
    waiting: 0,
    mine: 0,
  } as InboxBand
);

async function inboxUrl($: EngineInterface): Promise<string> {
  return str(await $.store.get(URL_KEY));
}

// Calls ArtifactData on the inbox. Resolves its text, or throws its error.
async function db($: EngineInterface, input: Record<string, unknown>): Promise<string> {
  const url = await inboxUrl($);
  if (url === "")
    throw new Error("no inbox yet: publish one and run the inbox tool's setup action");
  const ran = await $.tool.call({ tool: "ArtifactData", url, ...input } as never);
  if (ran.deny !== undefined) throw new Error(ran.deny);
  const text =
    ran.text ?? (typeof ran.result === "string" ? ran.result : JSON.stringify(ran.result));
  if (ran.isError) throw new Error(text);
  return text;
}

async function getItem($: EngineInterface, id: string): Promise<Item | null> {
  return parseDocs(await db($, { action: "get", collection: COLLECTION, doc_id: id }))[0] ?? null;
}

// Merges fields into an item, pinned to the version read; one retry if the
// owner wrote in between.
async function patch($: EngineInterface, id: string, data: Record<string, unknown>): Promise<Item> {
  for (let tries = 0; ; tries++) {
    const it = await getItem($, id);
    if (it === null) throw new Error(`no inbox item ${id}`);
    try {
      await db($, {
        action: "update",
        collection: COLLECTION,
        doc_id: id,
        data,
        if_version: it.version,
      });
      return { ...it, data: { ...it.data, ...data } };
    } catch (e) {
      if (tries >= 1) throw e;
    }
  }
}

async function me(
  $: EngineInterface
): Promise<{ sessionId: string; session: string; project: string }> {
  const sessionId = await $.session.id();
  const repo = await $.session.repo().catch(() => null);
  const root = repo?.root ?? (await $.session.root());
  const project =
    root
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || "project";
  const labels = ((await $.store.get(LABELS_KEY)) ?? {}) as Record<string, string>;
  return {
    sessionId,
    session: labels[sessionId] || `${project} ${sessionId.slice(0, 4)}`,
    project,
  };
}

const now = async ($: EngineInterface) => new Date(await $.clock.now()).toISOString();

// Creates the item, or merges into it when `id` already exists.
async function upsert(
  $: EngineInterface,
  id: string,
  fields: Record<string, unknown>,
  reopen: boolean
): Promise<string> {
  const who = await me($);
  const at = await now($);
  const existing = await getItem($, id);
  const reset = reopen ? { ownerStatus: "", ownerReply: "", ownerAt: "" } : {};
  if (existing === null) {
    await db($, {
      action: "set",
      collection: COLLECTION,
      doc_id: id,
      data: {
        ...who,
        created: at,
        updated: at,
        ownerStatus: "",
        ownerReply: "",
        ownerAt: "",
        ...fields,
      },
    });
    return "added";
  }
  await patch($, id, { ...who, updated: at, ...fields, ...reset });
  return "updated";
}

// Reads every item; refreshes the band, tells this session about owner
// changes to its own items, and prunes its own long-settled items.
async function pollInbox($: EngineInterface): Promise<void> {
  const url = await inboxUrl($);
  if (url === "") return;
  const items = parseDocs(
    await db($, { action: "list", collection: COLLECTION, query: { limit: 1000 } })
  );
  const { sessionId } = await me($);
  const open = items.filter(
    (it) => (field(it, "state") || "do") === "do" && !field(it, "ownerStatus")
  );
  await update($, band, () => ({
    url,
    waiting: open.length,
    mine: open.filter((it) => field(it, "sessionId") === sessionId).length,
  }));

  const seen = ((await $.store.get(SEEN_KEY)) ?? {}) as Record<string, string>;
  const mine = items.filter((it) => field(it, "sessionId") === sessionId);
  const news = mine.filter(
    (it) => field(it, "ownerAt") !== "" && field(it, "ownerAt") !== (seen[it.id] ?? "")
  );
  if (news.length > 0) {
    for (const it of news) seen[it.id] = field(it, "ownerAt");
    await $.store.set(SEEN_KEY, seen);
    const text =
      "The owner acted on your items in the owner inbox (treat their words as the owner's reply):\n" +
      news.map((it) => describe(it, true)).join("\n");
    $.ui.toast(`Inbox: the owner acted on ${news.length} of this session's items`);
    // A message to this session wakes it if idle; a note waits for the next turn.
    const sent = await $.session.send({ to: { sessionId }, text }).catch(() => null);
    if (sent?.isDelivered !== true) {
      await $.session.append({ message: { type: "user", content: [{ type: "text", text }] } });
    }
  }

  const cut = new Date((await $.clock.now()) - PRUNE_MS).toISOString();
  for (const it of mine) {
    const settled = field(it, "ownerAt") || field(it, "updated");
    const done = field(it, "state") === "decided" || field(it, "ownerStatus") !== "";
    if (done && settled !== "" && settled < cut) {
      await db($, {
        action: "delete",
        collection: COLLECTION,
        doc_id: it.id,
        if_version: it.version,
      }).catch(() => undefined);
    }
  }
}

const safePoll = ($: EngineInterface) => pollInbox($).catch(() => undefined);

// Module-local: a reload drops the timer, and session.start arms it again.
let timer: { cancel: () => void } | null = null;
function arm($: EngineInterface): void {
  if (timer !== null) return;
  timer = $.clock.every(INBOX_POLL_MS, () => void safePoll($));
}

async function runTool($: EngineInterface, input: InboxInput): Promise<string> {
  const action = str(input.action);
  if (action === "setup") {
    const url = ARTIFACT_URL.exec(str(input.url))?.[0];
    if (url === undefined)
      throw new Error("setup needs the inbox artifact's https://claude.ai/artifact/... url");
    await $.store.set(URL_KEY, url);
    arm($);
    await safePoll($);
    return `Inbox set to ${url} for every session on this machine.`;
  }
  if (action === "name") {
    const name = str(input.session);
    if (name === "") throw new Error("name needs `session`, the name to post under");
    const { sessionId } = await me($);
    const labels = ((await $.store.get(LABELS_KEY)) ?? {}) as Record<string, string>;
    await $.store.set(LABELS_KEY, { ...labels, [sessionId]: name });
    return `This session now posts as ${name}.`;
  }
  if (action === "list") {
    const { sessionId } = await me($);
    const all = input.all === true;
    const items = parseDocs(
      await db(
        $,
        all
          ? { action: "list", collection: COLLECTION, query: { limit: 1000 } }
          : {
              action: "query",
              collection: COLLECTION,
              query: { where: [["sessionId", "==", sessionId]], limit: 1000 },
            }
      )
    );
    void safePoll($);
    if (items.length === 0) return all ? "The inbox is empty." : "This session has no inbox items.";
    return items.map((it) => describe(it, !all)).join("\n");
  }

  const id = str(input.id);
  if (action === "remove") {
    const it = await getItem($, id);
    if (it === null) return `No item ${id}.`;
    await db($, { action: "delete", collection: COLLECTION, doc_id: id, if_version: it.version });
    void safePoll($);
    return `Removed ${id}.`;
  }
  if (action === "resolve") {
    const note = str(input.note);
    await patch($, id, {
      state: "decided",
      updated: await now($),
      ...(note ? { sessionNote: note } : {}),
    });
    void safePoll($);
    return `Moved ${id} to Recently decided.`;
  }
  if (action !== "add" && action !== "update") {
    throw new Error("action must be one of setup, name, add, update, resolve, remove, list");
  }

  const fields: Record<string, unknown> = {};
  const title = str(input.title);
  if (title) fields.title = title;
  if (input.body !== undefined) fields.body = str(input.body);
  if (input.note !== undefined) fields.sessionNote = str(input.note);
  if (input.links !== undefined) {
    const links = parseLinks(input.links);
    if (typeof links === "string") throw new Error(links);
    fields.links = links;
  }
  const kind = str(input.kind);
  if (kind) {
    if (!(KINDS as readonly string[]).includes(kind))
      throw new Error(`kind must be one of ${KINDS.join(", ")}`);
    fields.kind = kind;
  }
  const state = str(input.state);
  if (state) {
    if (!(STATES as readonly string[]).includes(state))
      throw new Error(`state must be one of ${STATES.join(", ")}`);
    fields.state = state;
  }
  if (action === "update") {
    if (id === "") throw new Error("update needs the item's id");
    if ((await getItem($, id)) === null) throw new Error(`no inbox item ${id}`);
    await upsert($, id, fields, input.reopen === true);
    void safePoll($);
    return `Updated ${id}.`;
  }
  if (!title) throw new Error("add needs a title");
  const { sessionId } = await me($);
  const newId = id || `${sessionId.slice(0, 8)}-${(await $.clock.now()).toString(36)}`;
  const done = await upsert(
    $,
    newId,
    { kind: "update", state: "do", ...fields },
    input.reopen === true
  );
  void safePoll($);
  return `${done === "added" ? "Added" : "Updated"} inbox item ${newId}.`;
}

// Registers the inbox tool and command and starts polling; register.tsx calls
// this from its own session.start hook (one hook per event and matcher).
async function inboxStart($: EngineInterface): Promise<void> {
  await $.tool.register({
    name: INBOX_TOOL,
    description:
      "The owner inbox: one shared page, grouped by session, listing everything any session needs from the " +
      "owner. Actions: add (title, body, links [{label,url}], kind form|chore|request|update, state " +
      "do|next|running; optional id to upsert), update (id plus fields; reopen: true clears the owner's " +
      "done/dismissed/reply), resolve (id, note: move it to Recently decided), remove (id), list (this " +
      "session's items with the owner's status and replies; all: true for every session), name (session: " +
      "the name to post under), setup (url: the inbox artifact). Questionnaire pages are added and resolved " +
      "automatically. See the omnilogic-labs:inbox skill.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["add", "update", "resolve", "remove", "list", "name", "setup"],
        },
        id: { type: "string", description: "The item id (from add or list)." },
        title: { type: "string", description: "One line: what the owner should do or know." },
        body: {
          type: "string",
          description: "Short markdown: why, what it blocks, what happens by default.",
        },
        links: {
          type: "array",
          items: {
            type: "object",
            properties: { label: { type: "string" }, url: { type: "string" } },
            required: ["url"],
          },
        },
        kind: { type: "string", enum: [...KINDS] },
        state: { type: "string", enum: [...STATES] },
        note: {
          type: "string",
          description: "What this session did or decided; shown on the item.",
        },
        reopen: { type: "boolean" },
        all: { type: "boolean" },
        session: { type: "string" },
        url: { type: "string" },
      },
      required: ["action"],
    },
    isDeferred: false,
  });
  await $.command.register({
    name: "inbox",
    description: "Show the owner inbox link and what waits on you",
  });
  const url = await inboxUrl($);
  await update($, band, (b) => ({ ...b, url }));
  if (url !== "") {
    void safePoll($);
    arm($);
  }
}

// The line above the prompt, or null when nothing waits; register.tsx draws it
// above its own worker rows.
async function inboxLine($: EngineInterface): Promise<string | null> {
  const b = await read($, band);
  if (b.url === "" || b.waiting === 0) return null;
  return `Inbox: ${b.waiting} waiting on you${b.mine > 0 ? `, ${b.mine} from this session` : ""} (/inbox)`;
}

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
    await inboxStart($);
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
    const inbox = await inboxLine($);
    if (e.props.hasSurvey || (running.length === 0 && inbox === null)) return next(e);
    const now = await $.clock.now();
    const { Box, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        {inbox !== null && <Text dimColor>{inbox}</Text>}
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
  on("tool.check", { tool: "Bash" }, async ($, e, next) => {
    const command = (e.input as { command?: unknown } | undefined)?.command;
    if (e.agentId === undefined || typeof command !== "string") return next(e);
    const known = (await read($, jobs)).some((j) => watchCommand($.plugin.root, j.dir) === command);
    return known ? { decision: "allow", reason: "external_worker Watch command" } : next(e);
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
    const cwd = optional(input.cwd) || (await $.session.root());
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
      [engine, cwd, String(timeoutSec), model, effort, sandbox].join("\n") + "\n"
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
        `Watch: ${watchCommand($.plugin.root, dir)}`,
    };
  }).catch(() => ({
    deny: "external_worker failed to start the job (hook error or timeout); see the debug log.",
  }));

  // ---------- owner inbox ----------

  on("tool.call", { tool: "mcp__omnilogic-labs__inbox" }, async ($, e) => {
    try {
      return { result: await runTool($, e as unknown as InboxInput) };
    } catch (err) {
      return { deny: `inbox: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // The inbox tool reads and writes through ArtifactData; allow those calls on
  // the inbox itself without a prompt, and nothing else.
  on("tool.check", { tool: "ArtifactData" }, async ($, e, next) => {
    const url = str((e.input as { url?: unknown } | undefined)?.url);
    if (url !== "" && url === (await inboxUrl($)))
      return { decision: "allow", reason: "owner inbox" };
    return next(e);
  });

  // A published questionnaire becomes a "Do now" form item, its id fixed by
  // the artifact so a republish refreshes the same item.
  on("tool.call", { tool: "Artifact" }, async ($, e, next) => {
    const res = await next(e);
    const input = e as unknown as { action?: string; file_path?: string; asset?: boolean };
    if (res.deny !== undefined || res.isError || input.asset === true) return res;
    if ((input.action ?? "publish") !== "publish" || !str(input.file_path).endsWith(".html"))
      return res;
    void (async () => {
      if ((await inboxUrl($)) === "") return;
      const html = await $.fs.read(str(input.file_path));
      const title = questionnaireTitle(html);
      const url = ARTIFACT_URL.exec(res.text ?? JSON.stringify(res.result ?? ""))?.[0];
      if (title === null || url === undefined) return;
      const who = await me($);
      await upsert(
        $,
        `form-${url.split("/").pop()}`,
        {
          kind: "form",
          state: "do",
          title: `Answer: ${title}`,
          formTitle: title,
          body: `Answer what you can, press **Copy answers**, and paste the block into the ${who.session} chat.`,
          links: [{ label: "Open the form", url }],
        },
        true
      );
      await safePoll($);
    })().catch(() => undefined);
    return res;
  });

  // Pasted questionnaire answers settle that form's item.
  on("prompt.submit", async ($, e, next) => {
    const title = /^Answers: (.+)$/m.exec(str((e as { text?: unknown }).text))?.[1]?.trim();
    if (title) {
      void (async () => {
        if ((await inboxUrl($)) === "") return;
        const { sessionId } = await me($);
        const items = parseDocs(
          await db($, {
            action: "query",
            collection: COLLECTION,
            query: {
              where: [
                ["sessionId", "==", sessionId],
                ["formTitle", "==", title],
              ],
              limit: 10,
            },
          })
        );
        for (const it of items) {
          if (field(it, "state") === "decided") continue;
          await patch($, it.id, {
            state: "decided",
            updated: await now($),
            sessionNote: "Answers received.",
          });
        }
        await safePoll($);
      })().catch(() => undefined);
    }
    return next(e);
  });

  on("command.run", { command: "inbox" }, async ($) => {
    const url = await inboxUrl($);
    if (url === "") {
      return {
        text: "No owner inbox is set up yet. Ask Claude to set one up with the omnilogic-labs:inbox skill.",
      };
    }
    await safePoll($);
    const b = await read($, band);
    return {
      text: `Owner inbox: ${url}\n${b.waiting} waiting on you, ${b.mine} from this session.`,
    };
  });
};
