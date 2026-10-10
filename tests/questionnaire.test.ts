// Renders the questionnaire skill's sample spec in happy-dom, answers every
// question through the page's own inputs, and checks the paste-back block.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";

import { build, render, validate } from "../src/skills/questionnaire/lib/build.mjs";

const SKILL = join(import.meta.dir, "../src/skills/questionnaire");
const SAMPLE = join(SKILL, "examples/sample.json");
const sample = () => JSON.parse(readFileSync(SAMPLE, "utf8"));

const windows: Window[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const w of windows.splice(0)) await w.happyDOM.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Page = {
  doc: Window["document"];
  win: Window;
  output: () => string;
  check: (id: string) => void;
  note: (id: string, text: string) => void;
};

async function open(html: string, opts: { clipboard?: "ok" | "refuse" } = {}): Promise<Page> {
  const win = new Window({
    url: "https://artifact.test/",
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
      disableCSSFileLoading: true,
    },
  });
  windows.push(win);
  if (opts.clipboard === "refuse") {
    Object.defineProperty(win.navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("NotAllowedError")) },
    });
  }
  win.document.write(html);
  await win.happyDOM.waitUntilComplete();
  const doc = win.document;
  const fire = (el: Element, type: string) =>
    el.dispatchEvent(new win.Event(type, { bubbles: true }));
  return {
    doc,
    win,
    output: () => (doc.getElementById("q-output") as unknown as HTMLTextAreaElement).value,
    check: (id) => {
      const el = doc.getElementById(id) as unknown as HTMLInputElement;
      el.checked = !el.checked || el.type === "radio";
      fire(el as unknown as Element, "change");
    },
    note: (id, text) => {
      const el = doc.getElementById(id) as unknown as HTMLTextAreaElement;
      el.value = text;
      fire(el as unknown as Element, "input");
    },
  };
}

test("the sample spec is valid", () => {
  expect(validate(sample())).toEqual([]);
});

test("validate names each missing field", () => {
  const errs = validate({
    title: "",
    questions: [
      { id: "a", title: "A", options: [] },
      { id: "a", title: "B", options: [{ label: "x" }], idk: "d" },
    ],
  });
  expect(errs).toContain("title: required string");
  expect(errs).toContain("questions[0].options: required, at least one");
  expect(errs.some((e) => e.startsWith("questions[0].idk"))).toBe(true);
  expect(errs).toContain('questions[1].id: duplicate id "a"');
});

test("remote images are refused", () => {
  const spec = sample();
  spec.questions[0].images = [{ path: "https://example.com/a.png" }];
  expect(validate(spec).join()).toContain("download remote images first");
});

test("every answer, note and I don't know reaches the answer block", async () => {
  const { html } = render(sample(), join(SKILL, "examples"));
  const p = await open(html);

  // Before answering, every question is listed as open.
  expect(p.output()).toContain("(0 of 3 answered; unanswered: style, targets, names)");

  p.check("q-0-opt-1"); // style: Smooth PBR
  p.note("q-0-note", "Match the concept art.\nWheels first.");
  p.check("q-1-opt-2"); // targets: Web
  p.check("q-1-opt-0"); // targets: Windows
  p.note("q-1-note", "Web is for the trade show.");
  p.check("q-2-idk"); // names: I don't know
  p.note("q-2-note", "Ask the modeler.");

  const out = p.output();
  expect(out).toContain("Answers: Rover art pass decisions");
  expect(out).toContain("(3 of 3 answered)");
  expect(out).toContain(
    "style. Which look should the rover models use? [blocking]\n  Answer: Smooth PBR [pbr]"
  );
  expect(out).toContain("  Note: Match the concept art. / Wheels first.");
  // Multi-select keeps the spec's order, not the click order.
  expect(out).toContain("  Answer: Windows [win]; Web [web]");
  expect(out).toContain("  Note: Web is for the trade show.");
  expect(out).toContain(
    "  Answer: I don't know. Default applies: We keep the placeholders until the art pass ends."
  );
  expect(out).toContain("  Note: Ask the modeler.");
  // The plain-text view shows the same block.
  expect(p.doc.getElementById("q-plain")?.textContent).toBe(out);
  expect(p.doc.getElementById("q-progress")?.textContent).toBe("3 of 3 answered");
});

test("I don't know and options exclude each other", async () => {
  const { html } = render(sample(), join(SKILL, "examples"));
  const p = await open(html);
  p.check("q-1-opt-0");
  p.check("q-1-idk");
  expect(p.output()).toContain("Default applies: We ship Windows only");
  expect(p.output()).not.toContain("Windows [win]");
  p.check("q-1-opt-1");
  expect(p.output()).toContain("  Answer: macOS [mac]");
  expect(p.output()).not.toContain("Default applies: We ship");
  expect((p.doc.getElementById("q-1-idk") as unknown as HTMLInputElement).checked).toBe(false);

  p.check("q-0-opt-0");
  p.check("q-0-idk");
  expect(p.output()).toContain("Default applies: We use low poly");
});

test("a refused clipboard leaves the text selected and says how to copy", async () => {
  const { html } = render(sample(), join(SKILL, "examples"));
  const p = await open(html, { clipboard: "refuse" });
  p.check("q-0-opt-0");
  (p.doc.getElementById("q-copy") as unknown as HTMLButtonElement).click();
  await p.win.happyDOM.waitUntilComplete();
  const status = p.doc.getElementById("q-status")?.textContent ?? "";
  expect(status).toContain("The text is selected");
  const out = p.doc.getElementById("q-output") as unknown as HTMLTextAreaElement;
  expect(out.hidden).toBe(false);
  expect(out.selectionStart).toBe(0);
  expect(out.selectionEnd).toBe(out.value.length);
});

test("spec text is escaped, not run as HTML", async () => {
  const spec = sample();
  spec.title = "Pick </script><b>bold</b>";
  spec.questions[0].background = "<img src=x onerror=alert(1)> and **real bold**";
  const { html } = render(spec, join(SKILL, "examples"));
  const p = await open(html);
  expect(p.doc.querySelector("h1")?.textContent).toBe("Pick </script><b>bold</b>");
  const sec = p.doc.querySelector(".q-sec")?.innerHTML ?? "";
  expect(sec).toContain("&lt;img");
  expect(sec).toContain("<strong>real bold</strong>");
  expect(p.output()).toContain("Answers: Pick </script><b>bold</b>");
});

test("build copies images and returns a files map with relative paths", async () => {
  const out = mkdtempSync(join(tmpdir(), "questionnaire-"));
  dirs.push(out);
  const { page, files } = build(SAMPLE, out);
  expect(page).toBe(join(out, "index.html"));
  expect(Object.keys(files)).toEqual(["images/01-render.svg"]);
  expect(readFileSync(files["images/01-render.svg"], "utf8")).toContain("<svg");
  const html = readFileSync(page, "utf8");
  expect(html.startsWith("<title>Rover art pass decisions</title>")).toBe(true);
  expect(html).not.toMatch(/<!doctype|<html|<body/i);
  const p = await open(html);
  expect(p.doc.querySelector("figure img")?.getAttribute("src")).toBe("images/01-render.svg");
});
