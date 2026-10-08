import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitAgent } from "./build.ts";
import { HOSTS } from "./hosts.ts";
import type { RenderError } from "./render.ts";

const BUILD = join(import.meta.dir, "build.ts");
const FIX = join(import.meta.dir, "fixtures");

const agent = (models = "") =>
  `---\nname: demo\ndescription: Demo agent.\ntier: deep\n${models}---\n\nBody.\n`;

function run(src: string, host = HOSTS.agy) {
  const errors: RenderError[] = [];
  const out = emitAgent("demo", src, "src/agents/demo.md", host, errors);
  return { errors, out };
}

describe("agy model check", () => {
  test("bad tier table value errors and emits nothing", () => {
    const host = { ...HOSTS.agy, tier: { deep: "gemini-ultra", fast: "flash" } };
    const { errors, out } = run(agent(), host);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("gemini-ultra");
    expect(errors[0].message).toContain("pro, flash, inherit");
    expect(errors[0].message).toContain("hosts.ts");
    expect(errors[0].line).toBe(4);
    expect(out.size).toBe(0);
  });

  test("bad models.agy override errors and emits nothing", () => {
    const { errors, out } = run(agent("models: { agy: gemini-ultra }\n"));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("gemini-ultra");
    expect(errors[0].message).toContain("pro, flash, inherit");
    expect(errors[0].line).toBe(5);
    expect(out.size).toBe(0);
  });

  test.each(["pro", "flash", "inherit"])("override %s passes", (m) => {
    const { errors, out } = run(agent(`models: { agy: ${m} }\n`));
    expect(errors).toEqual([]);
    expect([...out.values()][0].data).toContain(`model: ${m}`);
  });

  test.each(["pro", "flash", "inherit"])("tier value %s passes", (m) => {
    const host = { ...HOSTS.agy, tier: { deep: m, fast: m } };
    const { errors, out } = run(agent(), host);
    expect(errors).toEqual([]);
    expect(out.size).toBe(1);
  });

  test("codex and claude overrides stay unrestricted", () => {
    for (const h of ["codex", "claude"] as const) {
      const { errors, out } = run(agent(`models: { ${h}: anything-goes }\n`), HOSTS[h]);
      expect(errors).toEqual([]);
      expect(out.size).toBeGreaterThan(0);
    }
  });

  test("CLI exits 1 with the message and writes nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "omnikit-agy-model-"));
    try {
      const src = join(dir, "src");
      const out = join(dir, "out");
      await cp(join(FIX, "src"), src, { recursive: true });
      const f = join(src, "agents", "builder.md");
      const text = await readFile(f, "utf8");
      await writeFile(f, text.replace("agy: inherit", "agy: gemini-ultra"));
      const p = Bun.spawnSync(["bun", BUILD, "--src", src, "--out", out]);
      expect(p.exitCode).toBe(1);
      const err = p.stderr.toString();
      expect(err).toContain("gemini-ultra");
      expect(err).toContain("pro, flash, inherit");
      expect(await Bun.file(join(out, "dist/agy/agents/builder.md")).exists()).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
