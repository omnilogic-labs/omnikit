// omsg core: storage, watermarks, dedupe, address resolution, registry liveness
// and identity. Every test gets its own OMSG_DIR, so no real mail is touched.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressError, resolve } from "../plugins/omnilogic-labs/omsg/address";
import { main } from "../plugins/omnilogic-labs/omsg/cli";
import { fullName, keyOf, localHost, paths } from "../plugins/omnilogic-labs/omsg/paths";
import { pidStart } from "../plugins/omnilogic-labs/omsg/proc";
import { isLive, listAgents, register, type Entry } from "../plugins/omnilogic-labs/omsg/registry";

const PLUGIN = join(import.meta.dir, "../plugins/omnilogic-labs");
const SHIM = join(PLUGIN, "bin/omsg");
const CLI = join(PLUGIN, "omsg/cli.ts");
const HOST = localHost();

let dir = "";
const saved = { OMSG_DIR: process.env.OMSG_DIR, OMSG_NAME: process.env.OMSG_NAME };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omsg-test-"));
  process.env.OMSG_DIR = dir;
  delete process.env.OMSG_NAME;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function omsg(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (s) => out.push(s + "\n"), err: (s) => err.push(s + "\n") });
  return { code, out: out.join(""), err: err.join("") };
}

function shim(args: string[], stdin = "") {
  const p = Bun.spawnSync(["bash", SHIM, ...args], {
    stdin: new TextEncoder().encode(stdin),
    env: { ...process.env, OMSG_DIR: dir },
  });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

function deadPid(): number {
  const p = Bun.spawnSync(["true"]);
  return p.pid;
}

const reg = (
  sid: string,
  project: string,
  opts: { tool?: "claude" | "codex" | "agy"; pid?: number } = {}
) =>
  register({ tool: opts.tool || "claude", sid, pid: opts.pid ?? process.pid, cwd: dir, project });

test("10 concurrent senders, 20 messages each: all 200 read back exactly once, every line parses", async () => {
  const reader = fullName("claude", HOST, "proj", "rrrr");
  const start = Date.now() + 800;
  const child = `
    import { main } from ${JSON.stringify(CLI)};
    const n = process.env.N;
    while (Date.now() < ${start}) await Bun.sleep(1);
    const pad = "x".repeat(1500);
    for (let i = 0; i < 20; i++) {
      const code = await main(["--as", "owner", "send", ${JSON.stringify(reader)}, "p" + n + "-m" + i + " " + pad], { out() {}, err: (s) => console.error(s) });
      if (code !== 0) process.exit(code);
    }`;
  const procs = Array.from({ length: 10 }, (_, n) =>
    Bun.spawn(["bun", "-e", child], {
      env: { ...process.env, OMSG_DIR: dir, N: String(n) },
      stderr: "pipe",
    })
  );
  const codes = await Promise.all(procs.map((p) => p.exited));
  expect(codes).toEqual(Array(10).fill(0));

  const lines = readFileSync(paths.log("owner"), "utf8").split("\n");
  expect(lines.pop()).toBe("");
  expect(lines.length).toBe(200);
  for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();

  const r = await omsg("--as", reader, "read", "--json", "--max", "1000");
  expect(r.code).toBe(0);
  const recs = JSON.parse(r.out);
  expect(recs.length).toBe(200);
  const tags = new Set(recs.map((x: { body: string }) => x.body.split(" ")[0]));
  expect(tags.size).toBe(200);
  expect(new Set(recs.map((x: { id: string }) => x.id)).size).toBe(200);
  expect((await omsg("--as", reader, "read", "--json")).out.trim()).toBe("[]");
});

test("watermarks: a second read prints nothing", async () => {
  await omsg("send", "owner", "one");
  await omsg("send", "owner", "two");
  const first = await omsg("--as", "owner", "read");
  expect(first.out.trim().split("\n")).toHaveLength(2);
  expect(first.out).toMatch(/^omsg from owner \[[0-9a-f]{8}\]: one\n/);
  const second = await omsg("--as", "owner", "read");
  expect(second).toEqual({ code: 0, out: "", err: "" });
  expect((await omsg("--as", "owner", "count")).out).toBe("");
});

test("a duplicated record is delivered once, now and on a later read", async () => {
  await omsg("send", "owner", "hello");
  const line = readFileSync(paths.log("owner"), "utf8");
  appendFileSync(paths.log("owner"), line);
  expect(JSON.parse((await omsg("--as", "owner", "read", "--json")).out)).toHaveLength(1);
  appendFileSync(paths.log("owner"), line);
  appendFileSync(paths.notify("owner"), "");
  await Bun.sleep(5);
  Bun.spawnSync(["touch", paths.notify("owner")]);
  expect(JSON.parse((await omsg("--as", "owner", "read", "--json")).out)).toHaveLength(0);
});

test("a torn last line is skipped until it is complete", async () => {
  await omsg("send", "owner", "whole");
  const rec = JSON.stringify({
    id: "abcd1234",
    ts: new Date().toISOString(),
    from: "owner",
    to: "owner",
    thread: "abcd1234",
    body: "late",
  });
  appendFileSync(paths.log("owner"), rec.slice(0, 20));
  const first = JSON.parse((await omsg("--as", "owner", "read", "--json")).out);
  expect(first.map((r: { body: string }) => r.body)).toEqual(["whole"]);
  appendFileSync(paths.log("owner"), rec.slice(20) + "\n");
  await Bun.sleep(5);
  Bun.spawnSync(["touch", paths.notify("owner")]);
  const second = JSON.parse((await omsg("--as", "owner", "read", "--json")).out);
  expect(second.map((r: { body: string }) => r.body)).toEqual(["late"]);
});

test("a body over the 4 KB record cap is refused with a hint to send a file path", async () => {
  const r = await omsg("send", "owner", "y".repeat(5000));
  expect(r.code).toBe(1);
  expect(r.err).toMatch(/too long/);
  expect(r.err).toMatch(/file/);
  expect(existsSync(paths.log("owner"))).toBe(false);
  expect((await omsg("send", "owner", "y".repeat(3800))).code).toBe(0);
});

test("read --max holds the rest back, says so, and the next read gets them", async () => {
  for (let i = 0; i < 5; i++) await omsg("send", "owner", `m${i}`);
  const r = await omsg("--as", "owner", "read", "--max", "2");
  expect(r.out.trim().split("\n")).toEqual([
    expect.stringMatching(/: m0$/),
    expect.stringMatching(/: m1$/),
    "(+3 more: omsg read)",
  ]);
  expect((await omsg("--as", "owner", "count")).out).toBe("3\n");
  const rest = await omsg("--as", "owner", "read");
  expect(
    rest.out
      .trim()
      .split("\n")
      .map((l) => l.split(": ")[1])
  ).toEqual(["m2", "m3", "m4"]);
});

function entry(name: string, live: boolean, alias?: string): Entry {
  const m = name.match(/^(\w+)@([^/]+)\/(.+)#(.+)$/)!;
  return {
    name,
    key: keyOf(name),
    live,
    alias,
    tool: m[1] as Entry["tool"],
    host: m[2],
    project: m[3],
    cwd: "/",
    sid: m[4],
    pid: 1,
    pidStart: null,
    started: "",
    lastSeen: new Date().toISOString(),
  };
}

test("address resolution: full names, aliases, short forms, ambiguity", () => {
  const a = entry(`codex@${HOST}/omnikit#3f9a`, true, "builder");
  const b = entry(`claude@${HOST}/webapp#77aa`, true);
  const c = entry(`claude@${HOST}/webapp#88bb`, false, "reviewer");
  const d = entry(`agy@${HOST}/scratch#1234`, false); // dead, no alias: unreachable by short form
  const all = [a, b, c, d];
  const one = (addr: string) => resolve(addr, all).targets.map((t) => t.name);

  expect(one(a.name)).toEqual([a.name]);
  expect(one(`codex/omnikit#3f9a`)).toEqual([a.name]);
  expect(one("builder")).toEqual([a.name]);
  expect(one("reviewer")).toEqual([c.name]);
  expect(resolve("reviewer", all).targets[0].live).toBe(false);
  expect(one("codex/omnikit")).toEqual([a.name]);
  expect(one("#3f9a")).toEqual([a.name]);
  expect(one("omnikit")).toEqual([a.name]);
  expect(one("#88bb")).toEqual([c.name]);
  expect(one("owner")).toEqual(["owner"]);
  expect(one("me")).toEqual(["owner"]);
  expect(one("@webapp")).toEqual([b.name]);
  expect(one("all")).toEqual([a.name, b.name]);
  expect(() => resolve("scratch", all)).toThrow(AddressError);

  let err: AddressError | null = null;
  try {
    resolve("webapp", all);
  } catch (e) {
    err = e as AddressError;
  }
  expect(err).toBeInstanceOf(AddressError);
  expect(err!.candidates).toHaveLength(2);
  expect(err!.candidates.join("\n")).toContain("claude/webapp#77aa");
  expect(err!.candidates.join("\n")).toContain("claude/webapp#88bb (reviewer) offline");
});

test("an ambiguous short form exits 2 and lists the candidates on stderr", () => {
  reg("aaaa1111", "shared");
  reg("bbbb2222", "shared", { tool: "codex" });
  const r = shim(["send", "shared", "hi"]);
  expect(r.code).toBe(2);
  expect(r.err).toContain("claude/shared#aaaa");
  expect(r.err).toContain("codex/shared#bbbb");
  expect(shim(["send", "nobody", "hi"]).code).toBe(2);
  expect(shim(["send", "codex/shared", "hi"]).code).toBe(0);
});

test("a reused pid does not count as live", () => {
  const start = pidStart(process.pid)!;
  expect(start).toBeTruthy();
  const a = reg("cccc3333", "p");
  expect(isLive(a)).toBe(true);
  expect(isLive({ ...a, pidStart: start + "9" })).toBe(false);
  expect(isLive({ ...a, pid: deadPid() })).toBe(false);
  // Liveness never depends on hooks firing: an old lastSeen is still live.
  expect(isLive({ ...a, lastSeen: "2000-01-01T00:00:00.000Z" })).toBe(true);
});

test("who and send prune dead entries but keep a dead alias holder as queued", async () => {
  reg("dddd4444", "p", { pid: deadPid() });
  const held = reg("eeee5555", "p", { pid: deadPid() });
  await omsg("--as", held.name, "name", "rev"); // dead agents may hold an alias via --as
  expect(listAgents()).toHaveLength(2);
  const r = await omsg("send", "rev", "later");
  expect(r.out).toMatch(/^queued \[[0-9a-f]{8}\] for claude\/p#eeee \(offline\)\n$/);
  expect(listAgents().map((e) => e.name)).toEqual([held.name]);
});

test("a new session claiming a dead agent's alias gets its unread mail", async () => {
  const old = reg("ffff6666", "p", { pid: deadPid() });
  await omsg("--as", old.name, "name", "rev");
  await omsg("send", "rev", "for whoever is rev");
  const now = reg("abab7777", "p");
  expect((await omsg("--as", now.name, "count")).out).toBe("");
  expect((await omsg("--as", now.name, "name", "rev")).code).toBe(0);
  const r = await omsg("--as", "rev", "read");
  expect(r.out).toContain("for whoever is rev");
  // A live holder refuses.
  const other = reg("cdcd8888", "p");
  const refused = await omsg("--as", other.name, "name", "rev");
  expect(refused.code).toBe(1);
  expect(refused.err).toContain("held by live agent");
});

test("groups expand to live members; reply goes to the sender in the same thread", async () => {
  const a = reg("1111aaaa", "team");
  const b = reg("2222bbbb", "team", { tool: "codex" });
  reg("3333cccc", "team", { pid: deadPid() });
  const sent = await omsg("--json", "send", "@team", "standup");
  const recs = JSON.parse(sent.out);
  expect(recs.map((r: { to: string }) => r.to).sort()).toEqual([a.name, b.name].sort());

  const got = JSON.parse((await omsg("--as", a.name, "read", "--json")).out);
  expect(got).toHaveLength(1);
  const rep = await omsg("--as", a.name, "--json", "reply", got[0].id, "done");
  expect(rep.code).toBe(0);
  const back = JSON.parse((await omsg("--as", "owner", "read", "--json")).out);
  expect(back).toHaveLength(1);
  expect(back[0]).toMatchObject({ from: a.name, to: "owner", thread: got[0].id, body: "done" });
});

test("identity: the nearest registered ancestor process, else OMSG_NAME, else owner", () => {
  expect(JSON.parse(shim(["path"]).out).name).toBe("owner");
  const me = reg("9999dddd", "proj"); // this test runner is an ancestor of the shim
  const p = JSON.parse(shim(["path"]).out);
  expect(p.name).toBe(me.name);
  expect(p.notify).toBe(paths.notify(keyOf(me.name)));
  expect(p.ownerSeen).toBe(paths.seen("owner"));
  expect(JSON.parse(shim(["--as", "owner", "path"]).out).name).toBe("owner");
});

test("CLI: send owner, count 1, read one line, then count prints zero bytes", () => {
  expect(shim(["send", "owner", "hi"]).code).toBe(0);
  expect(shim(["--as", "owner", "count"]).out).toBe("1\n");
  const r = shim(["--as", "owner", "read"]);
  expect(r.out.trim().split("\n")).toHaveLength(1);
  const c = shim(["--as", "owner", "count"]);
  expect(c).toEqual({ code: 0, out: "", err: "" });
});

test("count with no mail opens no log: an unreadable log still gives empty output and exit 0", () => {
  if (process.getuid?.() === 0) return; // root reads mode 000 files anyway
  shim(["send", "owner", "hi"]);
  shim(["--as", "owner", "read"]);
  chmodSync(paths.log("owner"), 0o000);
  try {
    const c = shim(["--as", "owner", "count"]);
    expect(c).toEqual({ code: 0, out: "", err: "" });
    // The log really is unreadable: forcing the slow path fails.
    Bun.spawnSync(["touch", paths.notify("owner")]);
    expect(shim(["--as", "owner", "count"]).code).toBe(1);
  } finally {
    chmodSync(paths.log("owner"), 0o644);
  }
});

test("send - reads the body from stdin; wait returns 0 on mail and 3 on timeout", async () => {
  expect(shim(["--as", "owner", "wait", "--timeout", "0.2"]).code).toBe(3);
  expect(shim(["send", "owner", "-"], "from stdin\n").code).toBe(0);
  expect(shim(["--as", "owner", "wait", "--timeout", "1"]).code).toBe(0);
  expect(shim(["--as", "owner", "read"]).out).toContain(": from stdin\n");
});

test("codex UUIDv7 thread ids started together get distinct names", () => {
  // Real ids from three codex exec runs started in the same second.
  const ids = [
    "01a1a400-9995-7863-8918-f19356aeb320",
    "01a1a400-99a2-7863-94ba-0770797cb4aa",
    "01a1a400-99a1-75b0-be36-4fc476be71fc",
  ];
  const names = ids.map((s) => fullName("codex", HOST, "proj", s));
  expect(new Set(names).size).toBe(3);
  expect(names[0]).toBe(`codex@${HOST}/proj#b320`);
  // A UUIDv4 (claude, agy) keeps its first 4.
  expect(fullName("agy", HOST, "proj", "8db2d2c7-0d21-4851-b484-512776f164fe")).toBe(
    `agy@${HOST}/proj#8db2`
  );
});
