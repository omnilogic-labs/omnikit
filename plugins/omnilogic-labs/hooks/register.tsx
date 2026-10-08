import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { WorkerEngine, WorkerJob } from "../types";

// The tool is listed as mcp__<plugin>__<name>; the tool.call matcher below
// spells the full name as a literal so the engine's scan can read it.
const TOOL_NAME = "external_worker";
const ROOT = "/tmp/omnilogic-labs/workers";
const POLL_MS = 1000;
const DEFAULT_TIMEOUT_SEC = 1800;
const ENGINES: readonly WorkerEngine[] = ["codex", "agy", "fake"];

const jobs = atom({ plugin: "omnilogic-labs", key: "jobs" } as const, []);

type WorkerInput = {
  task?: unknown;
  engine?: unknown;
  cwd?: unknown;
  model?: unknown;
  effort?: unknown;
  timeoutSec?: unknown;
};

// Single-quote a string for bash.
const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

const optional = (v: unknown) => (typeof v === "string" ? v.trim() : "");

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

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const started = await next(e);
    await $.tool.register({
      name: TOOL_NAME,
      description:
        "Start an external coding worker (codex exec, agy -p, or the harmless fake engine) on a " +
        "self-contained task, in the background. Returns at once with a job id and output " +
        "directory. When the job ends a background task notification arrives; read the " +
        "output file it names, which ends with the worker's final message. Do not poll, " +
        "sleep, or read the job files to wait for it.",
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
          timeoutSec: {
            type: "number",
            description: `Optional wall-clock limit in seconds (default ${DEFAULT_TIMEOUT_SEC}).`,
          },
        },
        required: ["task", "engine"],
      },
      isDeferred: false,
    });
    for (const job of await read($, jobs)) if (job.status === "running") poll($, job.id);
    return started;
  });

  on("tool.call", { tool: "mcp__omnilogic-labs__external_worker" }, async ($, e) => {
    const input = e as unknown as WorkerInput;
    const task = typeof input.task === "string" ? input.task : "";
    const engine = input.engine as WorkerEngine;
    if (task.trim() === "") return { deny: "external_worker needs a non-empty task." };
    if (!ENGINES.includes(engine)) {
      return { deny: `external_worker engine must be one of ${ENGINES.join(", ")}.` };
    }
    const model = optional(input.model);
    const effort = optional(input.effort);
    const cwd = optional(input.cwd) || (await $.session.root());
    const timeoutSec =
      typeof input.timeoutSec === "number" && input.timeoutSec > 0
        ? Math.floor(input.timeoutSec)
        : DEFAULT_TIMEOUT_SEC;
    if ([cwd, model, effort].some((v) => v.includes("\n"))) {
      return { deny: "external_worker cwd, model and effort must be single lines." };
    }

    const sessionId = await $.session.id();
    const id = crypto.randomUUID().slice(0, 8);
    const dir = `${ROOT}/${sessionId}/${id}`;
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

    // Job dirs hold task text, which may carry secrets: create them 700.
    const made = await $.process.run(["bash", "-c", 'umask 077 && mkdir -p -- "$1"', "_", dir]);
    if (made.exitCode !== 0) {
      return { deny: `external_worker could not create ${dir}: ${made.stderr.trim()}` };
    }
    await $.fs.write(`${dir}/task.txt`, task);
    await $.fs.write(
      `${dir}/params`,
      [engine, cwd, String(timeoutSec), model, effort].join("\n") + "\n"
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
        `Output dir: ${dir}. When that task's notification arrives, read the output file it ` +
        `names for the final message; do not poll.`,
    };
  }).catch(() => ({
    deny: "external_worker failed to start the job (hook error or timeout); see the debug log.",
  }));
};
