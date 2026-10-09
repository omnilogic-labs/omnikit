import { expect, mock, test } from "claude-code/testing";
import type { On, RenderElement } from "claude-code";

import type { WorkerJob } from "../types";

const SESSION = "sess-1234";
const TOOL = "mcp__omnilogic-labs__external_worker";
// The tool runs only inside a subagent's loop (the external-runner agent).
const RUNNER: { agentId: string } = { agentId: "agent-runner-1" };

// On Windows the engine resolves $.fs paths against the current drive before
// the hooks below see them (/repo arrives as D:\repo), so the in-memory
// filesystem keys on the path with the drive and backslashes taken out.
const key = (path: string) => path.replace(/^[A-Za-z]:/, "").replaceAll("\\", "/");

// The world beneath the plugin: an in-memory filesystem with one real
// directory, a session id, and a Bash tool that records the call.
function world(on: On, options: { denyBash?: boolean } = {}) {
  const files = new Map<string, string>();
  const bash: string[] = [];
  const timeouts: (number | undefined)[] = [];
  const toasts: string[] = [];
  on("session.id", async () => ({ value: SESSION }));
  on("session.root", async () => ({ value: "/repo" }));
  on("process.run", async () => ({
    value: {
      exitCode: 0,
      stdout: "",
      stderr: "",
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }));
  on("fs.write", async (_$, e) => {
    files.set(key(e.path), e.text);
    return { value: undefined };
  });
  on("fs.read", async (_$, e) => {
    const text = files.get(key(e.path));
    if (text === undefined) return { deny: `ENOENT ${e.path}` };
    return { value: text };
  });
  on("fs.stat", async (_$, e) => {
    if (key(e.path) !== "/repo") return { deny: `ENOENT ${e.path}` };
    return { value: { kind: "dir" as const, size: 0, mtimeMs: 0, isLink: false } };
  });
  on("ui.toast", async (_$, e) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  on("tool.call", { tool: "Bash" }, async (_$, e) => {
    if (options.denyBash === true) return { deny: "not allowed" };
    const call = e as unknown as { command: string; timeout?: number };
    bash.push(String(call.command));
    timeouts.push(call.timeout);
    return { result: { backgroundTaskId: "bg-1" } };
  });
  // The plugin's state as it writes it ($.state is the kit's, beneath the test).
  const state: { jobs: WorkerJob[] } = { jobs: [] };
  on("state.set", { plugin: "omnilogic-labs", key: "jobs" }, async (_$, e, next) => {
    state.jobs = e.value as WorkerJob[];
    return next(e);
  });
  return { files, bash, timeouts, toasts, state };
}

test("a fake job moves from running to done when exit appears", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const w = world(on);

  const started = await $.tool.call({ tool: TOOL, task: "SENTINEL-42", engine: "fake", ...RUNNER });
  expect(started.deny).toBeUndefined();
  expect(String(started.result)).toContain("bg-1");

  const [job] = w.state.jobs;
  expect(job?.status).toBe("running");
  expect(job?.taskId).toBe("bg-1");
  expect(job?.dir).toBe(`/tmp/omnilogic-labs/workers/${SESSION}/${job?.id}`);
  expect(w.files.get(`${job?.dir}/task.txt`)).toBe("SENTINEL-42");
  expect(w.files.get(`${job?.dir}/params`)).toBe("fake\n/repo\n1800\n\n\n");
  expect(w.bash).toHaveLength(1);
  expect(w.bash[0]).toContain("/hooks/run-worker.sh'");
  // Without a timeout, Claude Code stops a background command at 10 minutes.
  expect(w.timeouts).toEqual([(1800 + 60) * 1000]);

  // Still running while the stream grows and no exit file exists.
  w.files.set(`${job?.dir}/stream.jsonl`, '{"n":1}\n{"n":2}\n');
  await clock.advance(1_000);
  const [mid] = w.state.jobs;
  expect(mid?.status).toBe("running");
  expect(mid?.lines).toBe(2);

  w.files.set(`${job?.dir}/last.txt`, "fake worker finished: SENTINEL-42\n");
  w.files.set(`${job?.dir}/exit`, "0\n");
  await clock.advance(1_000);
  const [done] = w.state.jobs;
  expect(done?.status).toBe("done");
  expect(done?.exitCode).toBe(0);
  expect(w.toasts).toEqual([`fake job ${job?.id} finished (exit 0)`]);
});

test("a missing cwd fails the job with a non-zero exit and no Bash call", async ($, on) => {
  mock.clock(on, { now: 1_000 });
  const w = world(on);

  await $.tool.call({ tool: TOOL, task: "x", engine: "fake", cwd: "/nope", ...RUNNER });
  const [job] = w.state.jobs;
  expect(job?.status).toBe("failed");
  expect(job?.exitCode).toBe(2);
  expect(w.files.get(`${job?.dir}/exit`)).toBe("2\n");
  expect(w.bash).toHaveLength(0);
});

test("a denied Bash call marks the job failed", async ($, on) => {
  mock.clock(on, { now: 1_000 });
  const w = world(on, { denyBash: true });

  const ran = await $.tool.call({ tool: TOOL, task: "x", engine: "fake", ...RUNNER });
  expect(ran.deny ?? ran.text).toContain("not allowed");
  const [job] = w.state.jobs;
  expect(job?.status).toBe("failed");
});

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, columns: 100 } as never;

test("the band shows one line per running job and falls through at zero", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  world(on);
  const SENTINEL = "NEXT-FALLTHROUGH";
  on(
    "ui.render",
    { component: "AbovePrompt" },
    async () => ({ type: "Text", props: {}, children: [SENTINEL] }) as never
  );

  const idle = await $.ui.mount({
    plugin: "omnilogic-labs",
    surface: "terminal",
    component: "AbovePrompt",
    props: PROPS,
  });
  expect(JSON.stringify(await idle.drawn())).toContain(SENTINEL);
  await idle.unmount();

  await $.tool.call({ tool: TOOL, task: "one", engine: "fake", ...RUNNER });
  await $.tool.call({ tool: TOOL, task: "two", engine: "codex", ...RUNNER });
  await clock.advance(65_000);
  const ui = await $.ui.mount({
    plugin: "omnilogic-labs",
    surface: "terminal",
    component: "AbovePrompt",
    props: PROPS,
  });
  const drawn: RenderElement = await ui.drawn();
  const lines = await ui.findAll({ type: "Text" });
  expect(lines).toHaveLength(2);
  const text = JSON.stringify(drawn);
  expect(text).toContain("fake");
  expect(text).toContain("codex");
  expect(text).toContain("01:05");
  expect(text).not.toContain(SENTINEL);
  await ui.unmount();
});

test("the band summarizes codex item.completed lines", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const w = world(on);
  await $.tool.call({ tool: TOOL, task: "x", engine: "codex", ...RUNNER });
  const [job] = w.state.jobs;
  w.files.set(
    `${job?.dir}/stream.jsonl`,
    '{"type":"item.completed","item":{"type":"agent_message","text":"  hello   world "}}\n'
  );
  await clock.advance(1_000);
  const ui = await $.ui.mount({
    plugin: "omnilogic-labs",
    surface: "terminal",
    component: "AbovePrompt",
    props: PROPS,
  });
  expect(JSON.stringify(await ui.drawn())).toContain("item.completed:agent_message hello world");
  await ui.unmount();
});

test("the workers pane tails the stream with status", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const w = world(on);
  await $.tool.call({ tool: TOOL, task: "x", engine: "fake", ...RUNNER });
  const [job] = w.state.jobs;
  w.files.set(`${job?.dir}/stream.jsonl`, '{"n":1}\n{"n":2}\n');
  w.files.set(`${job?.dir}/exit`, "0\n");
  await clock.advance(1_000);
  const ui = await $.ui.mount({
    plugin: "omnilogic-labs",
    surface: "terminal",
    component: "Pane",
    requestId: "workers",
    props: { title: "Workers" } as never,
  });
  const text = JSON.stringify(await ui.drawn());
  expect(text).toContain("done");
  expect(text).toContain("exit 0");
  expect(text).toContain('{\\"n\\":2}');
  await ui.unmount();
});

test("a call from the main loop is denied and points at the external-runner agent", async ($, on) => {
  mock.clock(on, { now: 1_000 });
  const w = world(on);

  const ran = await $.tool.call({ tool: TOOL, task: "x", engine: "fake" });
  expect(ran.deny).toContain("omnilogic-labs:external-runner");
  expect(w.state.jobs).toHaveLength(0);
  expect(w.bash).toHaveLength(0);
});

test("the result names a Watch command that tool.check allows only for that job", async ($, on) => {
  mock.clock(on, { now: 1_000 });
  const w = world(on);
  on("tool.check", { tool: "Bash" }, async () => ({ decision: "ask" as const }));

  const started = await $.tool.call({ tool: TOOL, task: "x", engine: "fake", ...RUNNER });
  const [job] = w.state.jobs;
  const watch = /Watch: (.+)$/.exec(String(started.result))?.[1] ?? "";
  expect(watch).toContain("/hooks/watch-worker.sh'");
  expect(watch).toContain(`'${job?.dir}'`);

  const check = (command: string, agentId?: string) =>
    $.tool.check({ tool: "Bash", input: { command }, ...(agentId ? { agentId } : {}) } as never);
  expect((await check(watch, "agent-runner-1")).decision).toBe("allow");
  expect((await check(`${watch}; rm -rf /`, "agent-runner-1")).decision).toBe("ask");
  expect((await check(watch)).decision).toBe("ask");
});

test("the transcript row shows a short task, not the whole prompt", async ($, on) => {
  on(
    "ui.render",
    { component: "ToolUse" },
    async (_$, e) =>
      ({
        type: "Text",
        props: {},
        children: [String((e.props.input as { task: string }).task)],
      }) as never
  );
  const long = `${"word ".repeat(100)}END-OF-TASK`;
  const ui = await $.ui.mount({
    plugin: "omnilogic-labs",
    surface: "terminal",
    component: "ToolUse",
    props: {
      tool_use_id: "tu-1",
      tool: TOOL,
      input: { engine: "codex", task: long },
      isRunning: true,
      isErrored: false,
      isInterrupted: false,
    } as never,
  });
  const text = JSON.stringify(await ui.drawn());
  expect(text).toContain(`(${long.length} chars)`);
  expect(text).not.toContain("END-OF-TASK");
  await ui.unmount();
});

test("timeoutSec is capped below the 2 hour background limit", async ($, on) => {
  mock.clock(on, { now: 1_000 });
  const w = world(on);
  await $.tool.call({ tool: TOOL, task: "x", engine: "fake", timeoutSec: 99_999, ...RUNNER });
  const [job] = w.state.jobs;
  expect(job?.timeoutSec).toBe(7_140);
  expect(w.timeouts).toEqual([7_200_000]);
});
