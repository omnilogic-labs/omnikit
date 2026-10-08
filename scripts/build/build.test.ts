import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, compile, diffClaudeTree, emitAgent } from "./build";
import { HOSTS, HOST_NAMES, varsFor } from "./hosts";
import { filterFrontmatter, render, tomlString, type RenderError } from "./render";

const FIX = join(import.meta.dir, "fixtures");
const BUILD = join(import.meta.dir, "build.ts");
const tmps: string[] = [];
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), "omnikit-build-test-"));
  tmps.push(d);
  return d;
};
afterAll(async () => {
  for (const d of tmps) await rm(d, { recursive: true, force: true });
});

const r = (text: string, host = "claude") =>
  render(text, host, varsFor(host as never), "t.md", HOST_NAMES);
const ok = (text: string, host = "claude") => {
  const res = r(text, host);
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.text;
};
const errs = (text: string, host = "claude") => {
  const res = r(text, host);
  if (res.ok) throw new Error("expected an error");
  return res.errors;
};

describe("vars", () => {
  test("tier, effort, tool, host and agents.dir resolve per host", () => {
    expect(ok("{{tier.deep}} {{tier.fast}}", "claude")).toBe("opus sonnet");
    expect(ok("{{tier.deep}} {{effort.deep}} {{effort.fast}}", "codex")).toBe(
      "gpt-6.1-sol high medium"
    );
    expect(ok("{{tier.deep}} {{cli.fast}}", "agy")).toBe("pro gemini-3.8-flash-medium");
    expect(ok("{{tool.agent}} {{tool.agentType}}", "claude")).toBe("Agent subagent_type");
    expect(ok("{{tool.agent}}", "codex")).toBe("spawn_agent");
    expect(ok("{{tool.agent}}", "agy")).toBe("invoke_subagent");
    expect(ok("{{host.name}} {{agents.dir}}", "agy")).toBe("agy ../../agents");
    expect(ok("{{ tier.deep }}", "claude")).toBe("opus");
  });

  test("cross-host vars resolve the same on every host", () => {
    for (const h of HOST_NAMES) {
      expect(
        ok("{{claude.tier.deep}}|{{codex.tier.fast}}|{{codex.effort.deep}}|{{agy.cli.deep}}", h)
      ).toBe("opus|gpt-6-luna|high|gemini-3.1-pro-high");
    }
  });
});

describe("@if blocks", () => {
  const src = [
    "top",
    "<!-- @if claude -->",
    "claude only",
    "<!-- @endif -->",
    "<!-- @if codex, agy -->",
    "codex or agy",
    "<!-- @endif -->",
    "bottom",
    "",
  ].join("\n");

  test("single host block", () => {
    expect(ok(src, "claude")).toBe("top\nclaude only\nbottom\n");
  });

  test("multi host block", () => {
    expect(ok(src, "codex")).toBe("top\ncodex or agy\nbottom\n");
    expect(ok(src, "agy")).toBe("top\ncodex or agy\nbottom\n");
  });

  test("vars inside a dropped block are not checked", () => {
    expect(ok("<!-- @if codex -->\n{{effort.deep}}\n<!-- @endif -->\nx\n", "claude")).toBe("x\n");
  });

  test("a file without directives renders byte-identical", async () => {
    const plain = "---\nname: x\n---\r\n\n# Title\r\n\ttabbed  \n\nno trailing newline";
    for (const h of HOST_NAMES) expect(ok(plain, h)).toBe(plain);
    const real = await readFile(join(FIX, "src/skills/demo/references/plain.md"), "utf8");
    for (const h of HOST_NAMES) expect(ok(real, h)).toBe(real);
  });
});

describe("errors name file and line", () => {
  const one = (e: RenderError[]) => {
    expect(e.length).toBeGreaterThan(0);
    return e[0];
  };

  test("unknown var", () => {
    const e = one(errs("a\nb {{nope}}\n"));
    expect(e).toMatchObject({ file: "t.md", line: 2 });
    expect(e.message).toContain("unknown var {{nope}}");
  });

  test("unknown var only defined for another host", () => {
    expect(one(errs("{{effort.deep}}", "claude")).message).toContain("unknown var");
  });

  test("unknown host in @if", () => {
    const e = one(errs("x\n<!-- @if claude,gemini -->\ny\n<!-- @endif -->\n"));
    expect(e).toMatchObject({ line: 2 });
    expect(e.message).toContain('unknown host "gemini"');
  });

  test("@endif without @if", () => {
    const e = one(errs("x\n\n<!-- @endif -->\n"));
    expect(e).toMatchObject({ line: 3 });
    expect(e.message).toContain("@endif without @if");
  });

  test("unclosed @if", () => {
    const e = one(errs("x\n<!-- @if codex -->\ny\n"));
    expect(e).toMatchObject({ line: 2 });
    expect(e.message).toContain("unclosed @if");
  });

  test("nested @if", () => {
    const e = one(
      errs("<!-- @if claude -->\n<!-- @if codex -->\n<!-- @endif -->\n<!-- @endif -->\n")
    );
    expect(e).toMatchObject({ line: 2 });
    expect(e.message).toContain("nested @if");
  });

  test("unknown directive", () => {
    expect(one(errs("<!-- @else -->\n")).message).toContain("unknown directive @else");
  });

  test("the CLI exits non-zero naming the fixture file and line", async () => {
    const out = await tmp();
    const p = Bun.spawnSync(["bun", BUILD, "--src", join(FIX, "bad-var"), "--out", out]);
    expect(p.exitCode).not.toBe(0);
    const stderr = p.stderr.toString();
    expect(stderr).toContain(join(FIX, "bad-var/skills/bad/SKILL.md") + ":9:");
    expect(stderr).toContain("unknown var {{nope}}");
    expect(await stat(join(out, "plugins")).catch(() => null)).toBeNull();
  });
});

describe("frontmatter filtering", () => {
  const md =
    "---\nname: x\ndescription: >-\n  two\n  lines\nlicense: MIT\nmetadata:\n  a: 1\n---\n\nbody\n";

  test("null keeps every key byte-identical", () => {
    expect(filterFrontmatter(md, null)).toBe(md);
  });

  test("a key list drops other keys with their continuation lines", () => {
    expect(filterFrontmatter(md, ["name", "description"])).toBe(
      "---\nname: x\ndescription: >-\n  two\n  lines\n---\n\nbody\n"
    );
  });

  test("the build applies a host's key list to SKILL.md only", async () => {
    const saved = HOSTS.agy.skillFrontmatterKeys;
    HOSTS.agy.skillFrontmatterKeys = ["name", "description"];
    try {
      const { out, errors } = await compile(join(FIX, "src"));
      expect(errors).toEqual([]);
      const agy = out.get("dist/agy/skills/demo/SKILL.md")!.data as string;
      const claude = out.get("plugins/omnilogic-labs/skills/demo/SKILL.md")!.data as string;
      expect(agy).not.toContain("license:");
      expect(agy).not.toContain("author:");
      expect(claude).toContain("license: MIT");
      expect(claude).toContain("author: fixture");
    } finally {
      HOSTS.agy.skillFrontmatterKeys = saved;
    }
  });
});

describe("TOML", () => {
  test("a body with quotes, backslashes and control chars round-trips", () => {
    const body = 'Say "hi" \\ and C:\\tmp\\x\n"""triple"""\ttab\r\nbell\u0007 end\n';
    const doc = `a = ${tomlString(body, true)}\nb = ${tomlString(body)}\n`;
    const parsed = Bun.TOML.parse(doc) as { a: string; b: string };
    expect(parsed.a).toBe(body);
    expect(parsed.b).toBe(body);
  });

  test("emitted Codex agent parses with every field", () => {
    const errors: RenderError[] = [];
    const src = '---\nname: q\ndescription: Says "hi" \\ there\ntier: deep\n---\n\nBody "x" \\ y\n';
    const out = emitAgent("q", src, "q.md", HOSTS.codex, errors);
    expect(errors).toEqual([]);
    const toml = Bun.TOML.parse(out.get("dist/codex/agents/q.toml")!.data as string);
    expect(toml).toEqual({
      name: "q",
      description: 'Says "hi" \\ there',
      model: "gpt-6.1-sol",
      model_reasoning_effort: "high",
      developer_instructions: 'Body "x" \\ y\n',
    });
    expect(out.get("dist/codex/agents/q.md")!.data).toBe('Body "x" \\ y\n');
  });
});

describe("agents", () => {
  test("per host output, overrides and host filter", async () => {
    const { out, errors } = await compile(join(FIX, "src"));
    expect(errors).toEqual([]);
    const get = (p: string) => out.get(p)?.data as string | undefined;

    const claudePlanner = get("plugins/omnilogic-labs/agents/planner.md")!;
    expect(claudePlanner).toContain("model: opus\n");
    expect(claudePlanner).not.toContain("tier:");
    const helper = get("plugins/omnilogic-labs/agents/helper.md")!;
    expect(helper).toContain("model: haiku\n");
    expect(helper).toContain("effort: low\n");
    expect(helper).toContain("tools: Read\n");
    expect(helper).not.toMatch(/models:|hosts:/);

    expect(get("dist/codex/agents/helper.toml")).toBeUndefined();
    expect(get("dist/agy/agents/helper.md")).toBeUndefined();

    const agyBuilder = get("dist/agy/agents/builder.md")!;
    expect(agyBuilder).toContain("model: inherit\n");
    expect(agyBuilder).not.toContain("effort:");
    expect(get("dist/agy/agents/planner.md")).toContain("model: pro\n");
    expect(get("dist/agy/agents/planner.md")).not.toContain("`Agent`");
    expect(get("dist/codex/agents/builder.toml")).toContain('model = "gpt-6-luna"');
  });

  test("model: in a source is rejected", () => {
    const errors: RenderError[] = [];
    emitAgent(
      "x",
      "---\nname: x\ndescription: d\nmodel: opus\n---\n\nb\n",
      "x.md",
      HOSTS.claude,
      errors
    );
    expect(errors[0]).toMatchObject({ file: "x.md", line: 4 });
  });
});

describe("build and check", () => {
  test("fixture build writes all three trees, keeps exec bits and is check-clean", async () => {
    const out = await tmp();
    expect(await build(join(FIX, "src"), out)).toEqual([]);
    for (const p of [
      "plugins/omnilogic-labs/agents/planner.md",
      "dist/codex/agents/planner.toml",
      "dist/agy/agents/planner.md",
    ]) {
      expect((await stat(join(out, p))).isFile()).toBe(true);
    }
    const mode = (await stat(join(out, "dist/codex/skills/demo/scripts/run.sh"))).mode;
    expect(mode & 0o111).not.toBe(0);
    const srcSh = await readFile(join(FIX, "src/skills/demo/scripts/run.sh"));
    expect((await readFile(join(out, "dist/agy/skills/demo/scripts/run.sh"))).equals(srcSh)).toBe(
      true
    );

    const check = (o: string) =>
      Bun.spawnSync(["bun", BUILD, "--src", join(FIX, "src"), "--out", o, "--check"]);
    expect(check(out).exitCode).toBe(0);

    await writeFile(join(out, "plugins/omnilogic-labs/agents/planner.md"), "stale\n");
    await writeFile(join(out, "plugins/omnilogic-labs/skills/demo/extra.md"), "extra\n");
    await rm(join(out, "plugins/omnilogic-labs/skills/demo/references/plain.md"));
    const p = check(out);
    expect(p.exitCode).toBe(1);
    const listed = p.stdout.toString();
    expect(listed).toContain("plugins/omnilogic-labs/agents/planner.md");
    expect(listed).toContain("plugins/omnilogic-labs/skills/demo/extra.md");
    expect(listed).toContain("plugins/omnilogic-labs/skills/demo/references/plain.md");
    expect(await diffClaudeTree(out, out)).toEqual([]);
  });

  test("a rebuild wipes only the generated dirs", async () => {
    const out = await tmp();
    await Bun.write(join(out, "plugins/omnilogic-labs/README.md"), "keep\n");
    await Bun.write(join(out, "plugins/omnilogic-labs/skills/gone/SKILL.md"), "old\n");
    await Bun.write(join(out, "dist/other/keep.txt"), "keep\n");
    expect(await build(join(FIX, "src"), out)).toEqual([]);
    expect(await readFile(join(out, "plugins/omnilogic-labs/README.md"), "utf8")).toBe("keep\n");
    expect(await readFile(join(out, "dist/other/keep.txt"), "utf8")).toBe("keep\n");
    expect(
      await stat(join(out, "plugins/omnilogic-labs/skills/gone")).catch(() => null)
    ).toBeNull();
  });
});
