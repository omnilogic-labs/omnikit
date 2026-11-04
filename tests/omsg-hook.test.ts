// omsg hooks: each host's real hook stdin (tests/fixtures/omsg, captured from
// Codex 0.166 and agy 1.4.12) fed to `bin/omsg hook <event> --host <h>`, with
// OMSG_DIR in a temp dir. The test process stands in for the host: start gets
// --pid <this pid>, codex hooks run as our children and agy hooks under sh -c,
// as the real hosts run them.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../plugins/omnilogic-labs/omsg/cli";
import { HOOK_BUDGET, HOOK_MAX } from "../plugins/omnilogic-labs/omsg/hook";
import { fullName, localHost } from "../plugins/omnilogic-labs/omsg/paths";

const SHIM = join(import.meta.dir, "../plugins/omnilogic-labs/bin/omsg");
const FIX = join(import.meta.dir, "fixtures/omsg");
const fixture = (n: string) => readFileSync(join(FIX, `${n}.json`), "utf8");
const CODEX_SID = JSON.parse(fixture("codex-session-start")).session_id as string;
const AGY_SID = JSON.parse(fixture("agy-session-start")).conversationId as string;
const CODEX = fullName("codex", localHost(), "proj", CODEX_SID);
const AGY = fullName("agy", localHost(), "proj", AGY_SID);

let dir = "";
let env: Record<string, string | undefined> = {};
const saved = process.env.OMSG_DIR;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omsg-hook-test-"));
  process.env.OMSG_DIR = dir;
  env = { ...process.env, OMSG_DIR: dir };
  delete env.OMSG_NAME;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (saved === undefined) delete process.env.OMSG_DIR;
  else process.env.OMSG_DIR = saved;
});

type Run = { code: number | null; out: string; err: string };

/** Run bin/omsg as the host would: codex as our child, agy through `sh -c`. */
function hook(host: "codex" | "agy" | "claude", args: string[], stdin = "", extra = {}): Run {
  const argv = ["bash", SHIM, "hook", ...args.slice(0, 1), "--host", host, ...args.slice(1)];
  const cmd =
    host === "agy"
      ? ["sh", "-c", argv.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")]
      : argv;
  const p = Bun.spawnSync(cmd, {
    stdin: new TextEncoder().encode(stdin),
    env: { ...env, ...extra },
  });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

const start = (host: "codex" | "agy") =>
  hook(host, ["start", "--pid", String(process.pid)], fixture(`${host}-session-start`));

async function send(to: string, body: string) {
  const code = await main(["--as", "owner", "send", to, body], { out: () => {}, err: () => {} });
  expect(code).toBe(0);
}

async function who(): Promise<string[]> {
  let out = "";
  await main(["--as", "owner", "who", "--json"], { out: (s) => (out += s), err: () => {} });
  return (JSON.parse(out) as { name: string }[]).map((e) => e.name);
}

test("codex start registers, tells the rule as SessionStart context, and end unregisters", async () => {
  const r = start("codex");
  expect(r.code).toBe(0);
  const j = JSON.parse(r.out);
  expect(j.hookSpecificOutput.hookEventName).toBe("SessionStart");
  expect(j.hookSpecificOutput.additionalContext).toContain("never poll for it");
  expect(await who()).toEqual([CODEX]);

  const e = hook("codex", ["end"], fixture("codex-session-end"));
  expect([e.code, e.out]).toEqual([0, ""]);
  expect(await who()).toEqual([]);
});

test("agy start registers and tells the rule as an injected system message", async () => {
  const r = start("agy");
  expect(r.code).toBe(0);
  const text = JSON.parse(r.out).injectSteps[0].systemMessage.systemMessage;
  expect(text).toContain("omsg reply <id> <text>");
  expect(await who()).toEqual([AGY]);
});

test("claude start takes --sid --cwd --pid and prints the paths; end by --sid unregisters", async () => {
  const r = hook("claude", [
    "start",
    "--sid",
    "abcd1234",
    "--cwd",
    "/work/proj",
    "--pid",
    String(process.pid),
  ]);
  expect(r.code).toBe(0);
  const j = JSON.parse(r.out);
  const name = fullName("claude", localHost(), "proj", "abcd1234");
  expect(j.name).toBe(name);
  expect(Object.keys(j).sort()).toEqual(["name", "notify", "ownerNotify", "ownerSeen", "seen"]);
  expect(j.notify.startsWith(dir)).toBe(true);
  expect(await who()).toEqual([name]);
  expect(hook("claude", ["end", "--sid", "abcd1234"]).code).toBe(0);
  expect(await who()).toEqual([]);
});

test("codex post-tool with mail injects it as PostToolUse context, once", async () => {
  start("codex");
  await send(CODEX, "hello codex");
  const r = hook("codex", ["post-tool"], fixture("codex-post-tool"));
  expect(r.code).toBe(0);
  const j = JSON.parse(r.out);
  expect(j.hookSpecificOutput.hookEventName).toBe("PostToolUse");
  expect(j.hookSpecificOutput.additionalContext).toMatch(
    /^omsg from owner \[[0-9a-f]{8}\]: hello codex$/
  );
  // Delivery consumed it: the next call is the no-mail case.
  const again = hook("codex", ["post-tool"], fixture("codex-post-tool"));
  expect([again.code, again.out.length]).toEqual([0, 0]);
});

test("agy pre-invocation with mail injects it as a system message step", async () => {
  start("agy");
  await send(AGY, "hello agy");
  const r = hook("agy", ["pre-invocation"], fixture("agy-pre-invocation"));
  expect(r.code).toBe(0);
  const steps = JSON.parse(r.out).injectSteps;
  expect(steps).toHaveLength(1);
  expect(steps[0].systemMessage.systemMessage).toMatch(/: hello agy$/);
  expect(hook("agy", ["pre-invocation"], fixture("agy-pre-invocation")).out).toBe("");
});

test("with no mail both hosts print zero bytes", () => {
  start("codex");
  start("agy");
  for (const r of [
    hook("codex", ["post-tool"], fixture("codex-post-tool")),
    hook("agy", ["pre-invocation"], fixture("agy-pre-invocation")),
    hook("codex", ["stop"], fixture("codex-stop")),
    hook("agy", ["stop"], fixture("agy-stop")),
  ]) {
    expect([r.code, r.out.length, r.err]).toEqual([0, 0, ""]);
  }
});

test("agy post-tool always answers {}", async () => {
  start("agy");
  await send(AGY, "not here");
  const r = hook("agy", ["post-tool"], fixture("agy-post-tool"));
  expect([r.code, r.out.trim()]).toEqual([0, "{}"]);
  // The mail is still waiting for pre-invocation.
  expect(hook("agy", ["pre-invocation"], fixture("agy-pre-invocation")).out).toContain("not here");
});

test("stop with unread mail keeps the turn going: codex block, agy continue", async () => {
  start("codex");
  start("agy");
  await send(CODEX, "one more thing");
  await send(AGY, "one more thing");
  const c = JSON.parse(hook("codex", ["stop"], fixture("codex-stop")).out);
  expect(c.decision).toBe("block");
  expect(c.reason).toContain("one more thing");
  const a = JSON.parse(hook("agy", ["stop"], fixture("agy-stop")).out);
  expect(a.decision).toBe("continue");
  expect(a.reason).toContain("one more thing");
});

test("a restarted session gets its queued mail with the rule", async () => {
  start("codex");
  await send(CODEX, "while you were out");
  const text = JSON.parse(start("codex").out).hookSpecificOutput.additionalContext;
  expect(text).toContain("never poll for it");
  expect(text).toContain("while you were out");
});

test("an injection holds at most HOOK_MAX messages and ends with (+N more", async () => {
  start("codex");
  for (let i = 0; i < HOOK_MAX + 3; i++) await send(CODEX, `msg ${i}`);
  const text = JSON.parse(hook("codex", ["post-tool"], fixture("codex-post-tool")).out)
    .hookSpecificOutput.additionalContext as string;
  const lines = text.split("\n");
  expect(lines).toHaveLength(HOOK_MAX + 1);
  expect(lines[HOOK_MAX]).toBe("(+3 more: omsg read)");
  // The held-back mail comes with the next call.
  const next = JSON.parse(hook("codex", ["post-tool"], fixture("codex-post-tool")).out)
    .hookSpecificOutput.additionalContext as string;
  expect(next.split("\n")).toHaveLength(3);
});

test("an injection stays near the byte budget", async () => {
  start("agy");
  // Distinct bodies: two identical sends in one millisecond share an id.
  for (let i = 0; i < 4; i++) await send(AGY, `${i}${"x".repeat(900)}`);
  const text = JSON.parse(hook("agy", ["pre-invocation"], fixture("agy-pre-invocation")).out)
    .injectSteps[0].systemMessage.systemMessage as string;
  const lines = text.split("\n");
  expect(lines).toHaveLength(3);
  expect(lines[2]).toBe("(+2 more: omsg read)");
  expect(Buffer.byteLength(text)).toBeLessThan(HOOK_BUDGET + 200);
});

test("fast path: 20 no-mail post-tool calls with no bun on PATH print nothing", () => {
  start("codex");
  start("agy");
  const PATH = "/usr/bin:/bin";
  const noBun = Bun.spawnSync(["bash", "-c", "command -v bun"], { env: { PATH } });
  expect(noBun.exitCode).not.toBe(0);
  const stdin = fixture("codex-post-tool");
  let bytes = 0;
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) {
    const r = hook("codex", ["post-tool"], stdin, { PATH });
    expect(r.code).toBe(0);
    bytes += r.out.length + r.err.length;
  }
  const mean = (performance.now() - t0) / 20;
  expect(bytes).toBe(0);
  const agy = hook("agy", ["pre-invocation"], fixture("agy-pre-invocation"), { PATH });
  expect([agy.code, agy.out.length + agy.err.length]).toEqual([0, 0]);
  console.log(`omsg fast path: mean ${mean.toFixed(2)} ms per no-mail post-tool call`);
});

test("fast path: after mail is read, still no bun", async () => {
  start("codex");
  await send(CODEX, "read me");
  expect(hook("codex", ["post-tool"], fixture("codex-post-tool")).out).toContain("read me");
  const r = hook("codex", ["post-tool"], fixture("codex-post-tool"), { PATH: "/usr/bin:/bin" });
  expect([r.code, r.out.length + r.err.length]).toEqual([0, 0]);
});
