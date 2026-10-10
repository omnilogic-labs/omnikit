import { expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";

import { parseDocs, questionnaireTitle } from "./inbox";

const SESSION = "sess-abcdef12";
const TOOL = "mcp__omnilogic-labs__inbox";
const INBOX = "https://claude.ai/artifact/INBOX1";

type Doc = { data: Record<string, unknown>; version: number };

// The world beneath the plugin: a session in /repo/game, an in-memory artifact
// database answering ArtifactData in its real text format, and recorders for
// toasts, messages to the session, and Artifact publishes.
function world(on: On) {
  const docs = new Map<string, Doc>();
  const sent: string[] = [];
  const files = new Map<string, string>();
  const checks: string[] = [];
  mock.store(on);
  on("session.id", async () => ({ value: SESSION }));
  on("session.root", async () => ({ value: "/repo/game" }));
  on("session.repo", async () => ({ value: null }));
  on("ui.toast", async () => ({ value: undefined }));
  on("session.send", async (_$, e) => {
    sent.push(e.text);
    return { isDelivered: true as const };
  });
  on("prompt.submit", async (_$, e) => e as never);
  on("tool.check", async () => ({ decision: "ask" as const }) as never);
  on("fs.read", async (_$, e) => {
    const text = files.get(e.path);
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text };
  });
  const block = (list: [string, Doc][]) =>
    `${list.length} documents:\n=== BEGIN ARTIFACT DB x ===\n` +
    list.map(([id, d]) => JSON.stringify({ id, data: d.data, version: d.version })).join("\n") +
    "\n=== END ARTIFACT DB x ===";
  on("tool.call", { tool: "ArtifactData" }, async (_$, e) => {
    const c = e as unknown as {
      action: string;
      url: string;
      doc_id?: string;
      data?: Record<string, unknown>;
      if_version?: number;
      query?: { where?: [string, string, unknown][] };
    };
    checks.push(c.url);
    const id = c.doc_id ?? "";
    const cur = docs.get(id);
    switch (c.action) {
      case "get":
        return { result: block(cur ? [[id, cur]] : []) };
      case "list":
        return { result: block([...docs]) };
      case "query": {
        const where = c.query?.where ?? [];
        return {
          result: block([...docs].filter(([, d]) => where.every(([f, , v]) => d.data[f] === v))),
        };
      }
      case "set":
        if (cur && c.if_version !== cur.version) return { deny: "version required" };
        docs.set(id, { data: { ...c.data }, version: (cur?.version ?? 0) + 1 });
        return { result: `committed, now at version ${(cur?.version ?? 0) + 1}` };
      case "update":
        if (!cur || c.if_version !== cur.version)
          return { deny: `version mismatch, now ${cur?.version}` };
        docs.set(id, { data: { ...cur.data, ...c.data }, version: cur.version + 1 });
        return { result: `committed, now at version ${cur.version + 1}` };
      case "delete":
        docs.delete(id);
        return { result: "deleted" };
    }
    return { deny: "unknown action" };
  });
  on("tool.call", { tool: "Artifact" }, async () => ({
    result: { url: "https://claude.ai/artifact/FORM42", path: "/s/out/index.html" },
    text: "Published /s/out/index.html at https://claude.ai/artifact/FORM42 (Version 1)",
  }));
  return { docs, sent, files, checks };
}

const call = async (
  $: Parameters<Parameters<typeof test>[1]>[0],
  input: Record<string, unknown>
) => {
  const r = await $.tool.call({ tool: TOOL, ...input } as never);
  if (r.deny !== undefined) throw new Error(r.deny);
  return String(r.result);
};

test("parseDocs reads the documents out of an ArtifactData result", () => {
  const text =
    '1 document from collection "items":\n=== BEGIN ARTIFACT DB a1 - data ===\n' +
    '{"id":"probe","data":{"title":"Probe"},"version":3,"updatedAt":"x"}\n=== END ARTIFACT DB a1 ===';
  expect(parseDocs(text)).toEqual([{ id: "probe", version: 3, data: { title: "Probe" } }]);
  expect(
    questionnaireTitle('<title>A &amp; B</title><script type="application/json" id="q-spec">')
  ).toBe("A & B");
  expect(questionnaireTitle("<title>Plain</title>")).toBeNull();
});

test("without setup, the tool says how to set the inbox up", async ($, on) => {
  mock.clock(on, { now: 1_000 });
  world(on);
  const r = await $.tool.call({ tool: TOOL, action: "add", title: "x" } as never);
  expect(r.deny).toContain("no inbox yet");
});

test("add, name and list write this session's items with its project", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-10T12:00:00Z") });
  const w = world(on);
  await call($, { action: "setup", url: `see ${INBOX} for it` });
  await call($, { action: "name", session: "game-ac" });
  const added = await call($, {
    action: "add",
    title: "Run sudo fstrim /",
    kind: "chore",
    links: [{ label: "Guide", url: "https://example.com/trim" }],
  });
  const id = /item (\S+)\./.exec(added)?.[1] ?? "";
  expect(id.startsWith("sess-abc")).toBe(true);
  const doc = w.docs.get(id)?.data ?? {};
  expect(doc).toMatchObject({
    title: "Run sudo fstrim /",
    kind: "chore",
    state: "do",
    session: "game-ac",
    sessionId: SESSION,
    project: "game",
    ownerStatus: "",
    links: [{ label: "Guide", url: "https://example.com/trim" }],
  });
  expect(w.checks.every((u) => u === INBOX)).toBe(true);

  const bad = await $.tool.call({
    tool: TOOL,
    action: "add",
    title: "x",
    links: [{ url: "http://x" }],
  } as never);
  expect(bad.deny).toContain("https url");

  expect(await call($, { action: "list" })).toContain(`- ${id} [do, chore] Run sudo fstrim /`);
  await call($, { action: "resolve", id, note: "Done by hand." });
  expect(w.docs.get(id)?.data).toMatchObject({ state: "decided", sessionNote: "Done by hand." });
});

test("an owner reply on the page reaches the session that asked", async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse("2026-10-10T12:00:00Z") });
  const w = world(on);
  await call($, { action: "setup", url: INBOX });
  await call($, { action: "add", id: "q1", title: "Pick a palette" });
  // Another session's item, which this session must not be told about.
  w.docs.set("other", {
    data: { title: "Not mine", sessionId: "sess-other", state: "do", ownerAt: "z" },
    version: 1,
  });

  const d = w.docs.get("q1") as Doc;
  d.data = {
    ...d.data,
    ownerStatus: "done",
    ownerReply: "Go with the cool one.",
    ownerAt: "2026-10-10T12:03:00Z",
  };
  await clock.advance(5 * 60_000);
  expect(w.sent).toHaveLength(1);
  expect(w.sent[0]).toContain(
    'q1 [do, update] Pick a palette; owner marked it done; owner replied: "Go with the cool one."'
  );
  expect(w.sent[0]).not.toContain("Not mine");

  // Told once, not on every poll.
  await clock.advance(5 * 60_000);
  expect(w.sent).toHaveLength(1);
});

test("a published questionnaire becomes a form item, and pasted answers settle it", async ($, on) => {
  mock.clock(on, { now: Date.parse("2026-10-10T12:00:00Z") });
  const w = world(on);
  await call($, { action: "setup", url: INBOX });
  w.files.set(
    "/s/out/index.html",
    '<title>Wrist menu review</title>\n<script type="application/json" id="q-spec">{}</script>'
  );
  await $.tool.call({
    tool: "Artifact",
    file_path: "/s/out/index.html",
    icon: "checklist",
  } as never);
  await new Promise((r) => setTimeout(r, 50));
  const form = w.docs.get("form-FORM42")?.data ?? {};
  expect(form).toMatchObject({
    kind: "form",
    state: "do",
    title: "Answer: Wrist menu review",
    formTitle: "Wrist menu review",
    links: [{ label: "Open the form", url: "https://claude.ai/artifact/FORM42" }],
  });

  await $.prompt.submit({ text: "Answers: Wrist menu review\n(3 of 3 answered)\n..." } as never);
  await new Promise((r) => setTimeout(r, 50));
  expect(w.docs.get("form-FORM42")?.data).toMatchObject({
    state: "decided",
    sessionNote: "Answers received.",
  });
});

test("ArtifactData on the inbox is allowed without a prompt, other artifacts are not", async ($, on) => {
  mock.clock(on, { now: 1_000 });
  world(on);
  await call($, { action: "setup", url: INBOX });
  const mine = await $.tool.check({
    tool: "ArtifactData",
    input: { action: "list", url: INBOX },
  } as never);
  expect(mine.decision).toBe("allow");
  const other = await $.tool.check({
    tool: "ArtifactData",
    input: { action: "list", url: "https://claude.ai/artifact/OTHER" },
  } as never);
  expect(other.decision).not.toBe("allow");
});
