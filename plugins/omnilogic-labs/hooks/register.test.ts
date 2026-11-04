import { expect, mock, test } from "claude-code/testing";
import type { On, RenderElement } from "claude-code";
import type { Engine } from "claude-code/testing";

import type { WorkerJob } from "../types";

const SESSION = "sess-1234";
const FORM_URL = "https://claude.ai/artifact/FORM1";
const TOOL = "mcp__omnilogic-labs__external_worker";
// The tool runs only inside a subagent's loop (the external-runner agent).
const RUNNER: { agentId: string } = { agentId: "agent-runner-1" };

// On Windows the engine resolves $.fs paths against the current drive before
// the hooks below see them (/repo arrives as D:\repo), so the in-memory
// filesystem keys on the path with the drive and backslashes taken out.
const key = (path: string) => path.replace(/^[A-Za-z]:/, "").replaceAll("\\", "/");

// The world beneath the plugin: an in-memory filesystem with one real
// directory, a session id, and a Bash tool that records the call.
// options.jobs maps an earlier job id to the "cwd\nthread id" that the lookup
// of that job's folder prints.
// options.omsg answers each omsg call (its argv after `bash <root>/bin/omsg`)
// with stdout; options.mtimes gives files fs.stat finds, by path.
type WorldOptions = {
  denyBash?: boolean;
  jobs?: Record<string, string>;
  omsg?: (args: string[]) => string;
  mtimes?: Map<string, number>;
};

function world(on: On, options: WorldOptions = {}) {
  const files = new Map<string, string>();
  const bash: string[] = [];
  const timeouts: (number | undefined)[] = [];
  const toasts: string[] = [];
  const omsg: string[][] = [];
  on("session.id", async () => ({ value: SESSION }));
  on("session.root", async () => ({ value: "/repo" }));
  on("session.start", async (_$, e) => ({ cwd: e.cwd }));
  on("session.end", async (_$, e) => ({ sessionId: e.sessionId }));
  on("tool.register", async () => ({ value: undefined }) as never);
  on("command.register", async () => ({ value: undefined }) as never);
  // Publishing any page answers with one artifact link.
  on("tool.call", { tool: "Artifact" }, async () => ({ result: `Published ${FORM_URL}` }) as never);
  on("process.run", async (_$, e) => {
    const argv = e.argv;
    if (argv[0] === "bash" && (argv[1] ?? "").endsWith("/bin/omsg")) {
      const args = argv.slice(2);
      omsg.push(args);
      const stdout = options.omsg?.(args) ?? "";
      return {
        value: {
          exitCode: 0,
          stdout,
          stderr: "",
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      };
    }
    // The job lookup is bash -c <script> _ <root> <job id>; mkdir has no job id.
    const lookup = argv.length === 6;
    const found = lookup ? options.jobs?.[argv[5] ?? ""] : undefined;
    return {
      value: {
        exitCode: lookup && found === undefined ? 1 : 0,
        stdout: found ?? "",
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
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
    const mtime = options.mtimes?.get(key(e.path));
    if (mtime !== undefined) {
      return { value: { kind: "file" as const, size: 0, mtimeMs: mtime, isLink: false } };
    }
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
  return { files, bash, timeouts, toasts, state, omsg };
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
  expect(w.files.get(`${job?.dir}/params`)).toBe("fake\n/repo\n1800\n\n\nnone\n\n\n");
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
  // The engine's check asks for everything but the job's own run-worker call,
  // which the person running the session has allowed.
  on("tool.check", { tool: "Bash" }, async (_$, e) => {
    const command = String((e.input as { command?: unknown } | undefined)?.command);
    return { decision: command.includes("run-worker.sh") ? "allow" : "ask" } as never;
  });

  const started = await $.tool.call({ tool: TOOL, task: "x", engine: "fake", ...RUNNER });
  const [job] = w.state.jobs;
  const watch = /Watch: (.+)$/m.exec(String(started.result))?.[1] ?? "";
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

test("sandbox defaults to none, passes a known mode through, and refuses others", async ($, on) => {
  mock.clock(on, { now: 1_000 });
  const w = world(on);
  await $.tool.call({ tool: TOOL, task: "x", engine: "fake", sandbox: "read-only", ...RUNNER });
  const [job] = w.state.jobs;
  expect(w.files.get(`${job?.dir}/params`)).toBe("fake\n/repo\n1800\n\n\nread-only\n\n\n");

  const bad = await $.tool.call({
    tool: TOOL,
    task: "x",
    engine: "fake",
    sandbox: "full",
    ...RUNNER,
  });
  expect(bad.deny).toContain("sandbox must be one of none, workspace-write, read-only");
  expect(w.bash).toHaveLength(1);
});

test("resume takes a codex thread id, or an earlier job's thread and cwd", async ($, on) => {
  mock.clock(on, { now: 1_000 });
  const thread = "01a12831-5b9c-74c0-bce5-a117c6a4cd80";
  const w = world(on, { jobs: { "90813259": `/repo\n${thread}\n` } });
  const params = (i: number) => w.files.get(`${w.state.jobs[i]?.dir}/params`);

  await $.tool.call({ tool: TOOL, task: "go on", engine: "codex", resume: thread, ...RUNNER });
  expect(params(0)).toBe(`codex\n/repo\n1800\n\n\nnone\n${thread}\ncodex-${w.state.jobs[0]?.id}\n`);
  await $.tool.call({ tool: TOOL, task: "go on", engine: "codex", resume: "90813259", ...RUNNER });
  expect(params(1)).toBe(`codex\n/repo\n1800\n\n\nnone\n${thread}\ncodex-${w.state.jobs[1]?.id}\n`);

  const deny = async (input: Record<string, unknown>) =>
    (await $.tool.call({ tool: TOOL, task: "x", ...input, ...RUNNER } as never)).deny;
  expect(await deny({ engine: "codex", resume: "deadbeef" })).toContain("no codex thread");
  expect(await deny({ engine: "codex", resume: "../etc" })).toContain("thread id or");
  expect(await deny({ engine: "agy", resume: thread })).toContain("codex only");
  expect(w.state.jobs).toHaveLength(2);
});

// ---------- omsg mail ----------

const NAME = "claude/repo#sess";
const PATHS = {
  name: NAME,
  notify: "/mail/notify/me",
  seen: "/mail/seen/me",
  ownerNotify: "/mail/notify/owner",
  ownerSeen: "/mail/seen/owner",
};
const MAIL = [
  {
    id: "ab12cd34",
    ts: "t",
    from: "codex/repo#9f",
    to: NAME,
    thread: "ab12cd34",
    body: "hi there",
  },
];

// A session started with omsg answering: hook start prints PATHS, read --json
// prints MAIL, the owner's count prints ownerCount.
async function started($: Engine, on: On, extra: { ownerCount?: string } = {}) {
  const clock = mock.clock(on, { now: 1_000 });
  const stored = new Map<string, unknown>();
  // The plugin's store, kept here so the test can read what was written.
  on("store.get", async (_$, e) => ({ value: stored.get(e.key) }) as never);
  on("store.set", async (_$, e) => (stored.set(e.key, e.value), { value: undefined }) as never);
  on("store.delete", async (_$, e) => (stored.delete(e.key), { value: undefined }) as never);
  const session = mock.session(on);
  const mtimes = new Map([
    [PATHS.notify, 100],
    [PATHS.seen, 100],
    [PATHS.ownerNotify, 50],
  ]);
  const w = world(on, {
    mtimes,
    omsg: (args) => {
      if (args[0] === "hook" && args[1] === "start") return `${JSON.stringify(PATHS)}\n`;
      if (args.includes("read") && args.includes("--json")) return JSON.stringify(MAIL);
      if (args.join(" ") === "--as owner count") return extra.ownerCount ?? "";
      if (args.join(" ") === "--as owner read") return "omsg from codex/repo#9f [ab12cd34]: hi\n";
      return "";
    },
  });
  await $.session.start({ cwd: "/repo", surface: null, isInteractive: true } as never);
  await clock.settle();
  return { clock, session, mtimes, w, stored };
}

const texts = (session: { appended: () => readonly { message: unknown }[] }) =>
  session.appended().map((r) => JSON.stringify(r.message));

test("start registers with omsg, stores the name and tells the rule once", async ($, on) => {
  const { clock, session, w, stored } = await started($, on);
  expect(w.omsg[0]).toEqual([
    "hook",
    "start",
    "--host",
    "claude",
    "--sid",
    SESSION,
    "--cwd",
    "/repo",
  ]);
  expect((stored.get(`mail.${SESSION}`) as { name?: string }).name).toBe(NAME);
  const rules = texts(session).filter((t) => t.includes("never poll for it"));
  expect(rules).toHaveLength(1);

  // A reload fires session.start again; the rule is not told twice.
  await $.session.start({ cwd: "/repo", surface: null, isInteractive: true } as never);
  await clock.settle();
  expect(texts(session).filter((t) => t.includes("never poll for it"))).toHaveLength(1);
});

test("a tick with notify not newer than seen runs no process and sends nothing", async ($, on) => {
  const sent: string[] = [];
  on("session.send", async (_$, e) => (sent.push(e.text), { isDelivered: true as const }));
  const { clock, w } = await started($, on);
  const before = w.omsg.length;
  await clock.advance(30_000);
  expect(w.omsg.length).toBe(before);
  expect(sent).toHaveLength(0);
});

test("newer mail is read once and sent to the session", async ($, on) => {
  const sent: string[] = [];
  const to: unknown[] = [];
  on("session.send", async (_$, e) => {
    sent.push(e.text);
    to.push(e.to);
    return { isDelivered: true as const };
  });
  const { clock, mtimes, w } = await started($, on);
  mtimes.set(PATHS.notify, 200);
  await clock.advance(30_000);
  const reads = w.omsg.filter((a) => a.includes("read"));
  expect(reads).toHaveLength(1);
  expect(reads[0]?.slice(0, 4)).toEqual(["--as", NAME, "read", "--json"]);
  expect(sent).toEqual(["omsg from codex/repo#9f [ab12cd34]: hi there"]);

  // The same notify is not read again on the next tick.
  await clock.advance(30_000);
  expect(w.omsg.filter((a) => a.includes("read"))).toHaveLength(1);
});

test("mail falls back to a note when the send is not delivered", async ($, on) => {
  on("session.send", async () => ({ isDelivered: false as const, reason: "no" }) as never);
  const { clock, mtimes, session } = await started($, on);
  mtimes.set(PATHS.notify, 200);
  await clock.advance(30_000);
  expect(
    texts(session).some((t) => t.includes("omsg from codex/repo#9f [ab12cd34]: hi there"))
  ).toBe(true);
});

test("the band shows the owner's mail count and hides at zero", async ($, on) => {
  const { w } = await started($, on, { ownerCount: "3\n" });
  expect(w.omsg.some((a) => a.join(" ") === "--as owner count")).toBe(true);
  const ui = await $.ui.mount({
    plugin: "omnilogic-labs",
    surface: "terminal",
    component: "AbovePrompt",
    props: PROPS,
  });
  expect(JSON.stringify(await ui.drawn())).toContain("Mail: 3 for you (/mail)");
  await ui.unmount();
});

test("/mail reads, replies and sends as the owner", async ($, on) => {
  const { w } = await started($, on);
  const run = (args: string) =>
    $.command.run({ command: "mail", args, origin: { kind: "composer" } } as never);
  const read = await run("");
  expect(String(read.text)).toContain("hi");
  await run("reply ab12cd34 sounds good");
  await run("send codex/repo#9f please rebase");
  const owner = w.omsg.filter((a) => a[0] === "--as" && a[1] === "owner" && a[2] !== "count");
  expect(owner).toEqual([
    ["--as", "owner", "read"],
    ["--as", "owner", "reply", "ab12cd34", "sounds good"],
    ["--as", "owner", "send", "codex/repo#9f", "please rebase"],
  ]);
  expect(String((await run("bogus")).text)).toContain("Usage");
});

test("a single omsg Bash call is allowed and a chained one is not", async ($, on) => {
  world(on);
  on("tool.check", { tool: "Bash" }, async () => ({ decision: "ask" as const }));
  const check = (command: string) => $.tool.check({ tool: "Bash", input: { command } } as never);
  expect((await check('omsg send owner "done"')).decision).toBe("allow");
  expect((await check("omsg x; rm -rf y")).decision).toBe("ask");
  expect((await check("omsg read | sh")).decision).toBe("ask");
  expect((await check("omsg send owner $(cat ~/.ssh/id_rsa)")).decision).toBe("ask");
  expect((await check("ls")).decision).toBe("ask");
});

test("a questionnaire publish mails the owner the form's link", async ($, on) => {
  const { clock, w } = await started($, on);
  const url = FORM_URL;
  w.files.set(
    "/repo/q.html",
    '<html><head><title>Wrist menu review</title></head><body><script id="q-spec"></script></body></html>'
  );
  w.files.set("/repo/plain.html", "<html><head><title>Plain</title></head></html>");
  await $.tool.call({ tool: "Artifact", file_path: "/repo/q.html" } as never);
  await $.tool.call({ tool: "Artifact", file_path: "/repo/plain.html" } as never);
  await clock.settle();
  const sends = w.omsg.filter((a) => a.includes("send"));
  expect(sends).toEqual([["--as", NAME, "send", "owner", `Answer: Wrist menu review ${url}`]]);
});

test("a codex job carries its OMSG_NAME in params and a Mail line in its result", async ($, on) => {
  mock.clock(on, { now: 1_000 });
  const w = world(on);
  const ran = await $.tool.call({ tool: TOOL, task: "x", engine: "codex", ...RUNNER });
  const [job] = w.state.jobs;
  const params = w.files.get(`${job?.dir}/params`)?.split("\n") ?? [];
  expect(params[7]).toBe(`codex-${job?.id}`);
  expect(String(ran.result)).toMatch(new RegExp(`\\nMail: codex-${job?.id}$`));
});

test("session.end unregisters from omsg", async ($, on) => {
  const { w } = await started($, on);
  await $.session.end({ reason: "other", sessionId: SESSION, resume: {} } as never);
  expect(w.omsg.at(-1)).toEqual(["hook", "end", "--host", "claude", "--sid", SESSION]);
});
