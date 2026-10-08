import { afterAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, compile, diffCommittedTrees, emitAgent, ROLE_PROMPTS, ROLE_SKILL } from "./build";
import { HOSTS, HOST_NAMES, varsFor } from "./hosts";
import { OS_NAMES, OS_TARGETS, type OsTarget } from "./os";
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

const r = (text: string, host = "claude", os?: OsTarget) =>
  render(text, { host, os, vars: varsFor(host as never), file: "t.md", hosts: HOST_NAMES });
const ok = (text: string, host = "claude", os?: OsTarget) => {
  const res = r(text, host, os);
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.text;
};
const errs = (text: string, host = "claude", os?: OsTarget) => {
  const res = r(text, host, os);
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

describe("OS axis", () => {
  const block = (cond: string, body = "body") =>
    `top\n<!-- @if ${cond} -->\n${body}\n<!-- @endif -->\nbottom\n`;

  test("each single OS keeps its own block only", () => {
    for (const os of OS_NAMES) {
      const src = OS_NAMES.map((o) => `<!-- @if ${o} -->\n${o}\n<!-- @endif -->\n`).join("");
      expect(ok(src, "claude", os)).toBe(`${os}\n`);
    }
  });

  test("@if linux,wsl", () => {
    const src = block("linux,wsl");
    expect(ok(src, "claude", "linux")).toBe("top\nbody\nbottom\n");
    expect(ok(src, "claude", "wsl")).toBe("top\nbody\nbottom\n");
    expect(ok(src, "claude", "macos")).toBe("top\nbottom\n");
    expect(ok(src, "claude", "windows")).toBe("top\nbottom\n");
    expect(ok(block("linux , wsl"), "claude", "wsl")).toBe("top\nbody\nbottom\n");
  });

  test("combined host and OS block, in either order", () => {
    for (const cond of ["codex windows", "windows codex"]) {
      const src = block(cond);
      expect(ok(src, "codex", "windows")).toBe("top\nbody\nbottom\n");
      expect(ok(src, "codex", "linux")).toBe("top\nbottom\n");
      expect(ok(src, "agy", "windows")).toBe("top\nbottom\n");
    }
    expect(ok(block("codex,agy windows"), "agy", "windows")).toBe("top\nbody\nbottom\n");
  });

  test("any-OS keeps OS blocks under a label line", () => {
    expect(ok(block("windows"), "claude", "any")).toBe(
      "top\nOn Windows (Git Bash):\nbody\nbottom\n"
    );
    expect(ok(block("linux,wsl"), "claude", "any")).toBe("top\nOn Linux and WSL:\nbody\nbottom\n");
    expect(ok(block("linux,wsl,macos"))).toBe("top\nOn Linux, WSL and macOS:\nbody\nbottom\n");
    expect(ok(block("  claude"), "claude", "any")).toBe("top\nbody\nbottom\n");
    expect(ok(block("codex windows"), "claude", "any")).toBe("top\nbottom\n");
    expect(ok("  <!-- @if macos -->\r\n  x\r\n  <!-- @endif -->\r\n", "claude", "any")).toBe(
      "  On macOS:\r\n  x\r\n"
    );
  });

  test("{{os.shell}} resolves per OS", () => {
    expect(ok("{{os.shell}}", "claude", "linux")).toBe("bash");
    expect(ok("{{os.shell}}", "claude", "macos")).toBe("zsh");
    expect(ok("{{os.shell}} {{os.name}}", "codex", "windows")).toBe("Git Bash Windows");
    expect(ok(block("windows", "{{os.shell}}"), "claude", "any")).toBe(
      "top\nOn Windows (Git Bash):\nGit Bash\nbottom\n"
    );
    expect(ok(block("macos", "{{os.shell}}"), "claude", "linux")).toBe("top\nbottom\n");
  });

  test("{{os.shell}} outside an OS block fails under any", () => {
    const e = errs("x\n{{os.shell}}\n", "claude", "any");
    expect(e[0]).toMatchObject({ file: "t.md", line: 2 });
    expect(e[0].message).toContain("outside an OS block");
    expect(errs(block("claude", "{{os.shell}}"), "claude", "any")[0].message).toContain(
      "outside an OS block"
    );
  });

  test("{{os.shell}} in a two-OS block fails under any", () => {
    const e = errs(block("linux,wsl", "{{os.shell}}"), "claude", "any");
    expect(e[0]).toMatchObject({ line: 3 });
    expect(e[0].message).toContain("more than one OS");
  });

  test("unknown {{os.*}} key fails", () => {
    expect(errs("{{os.nope}}", "claude", "linux")[0].message).toContain("unknown var {{os.nope}}");
  });

  test("sources without OS blocks render the same for every OS", async () => {
    const real = await readFile(join(FIX, "src/skills/demo/references/plain.md"), "utf8");
    for (const os of OS_TARGETS) expect(ok(real, "codex", os)).toBe(real);
  });
});

describe("OS directive errors name file and line", () => {
  const cases: [string, string][] = [
    ["beos", 'unknown host or OS "beos"'],
    ["linux,beos", 'unknown OS "beos"'],
    ["codex,windows", "mixes hosts and OSes"],
    ["codex agy", "two host lists"],
    ["linux windows", "two OS lists"],
    ["codex windows linux", "at most two lists"],
  ];
  for (const [cond, msg] of cases) {
    test(`@if ${cond}`, () => {
      for (const os of OS_TARGETS) {
        const e = errs(`x\n<!-- @if ${cond} -->\ny\n<!-- @endif -->\n`, "codex", os);
        expect(e[0]).toMatchObject({ file: "t.md", line: 2 });
        expect(e[0].message).toContain(msg);
      }
    });
  }
});

describe("--os", () => {
  const fixtureOs = "skills/demo/references/os.md";
  const body = "Run the helper from";

  test("dist trees follow --os, the Claude tree stays any-OS, and .os records it", async () => {
    for (const os of ["linux", "windows", "any"] as OsTarget[]) {
      const out = await tmp();
      expect(await build(join(FIX, "src"), out, os)).toEqual([]);
      const claude = await readFile(join(out, "plugins/omnilogic-labs", fixtureOs), "utf8");
      expect(claude).toContain("On Windows (Git Bash):\n\nRun the helper from Git Bash");
      for (const h of ["codex", "agy"]) {
        const dist = await readFile(join(out, "dist", h, fixtureOs), "utf8");
        expect(await readFile(join(out, "dist", h, ".os"), "utf8")).toBe(`${os}\n`);
        if (os === "linux") expect(dist).not.toContain(body);
        if (os === "windows") {
          expect(dist).toContain(`${body} Git Bash`);
          expect(dist).not.toContain("On Windows");
        }
        if (os === "any") expect(dist).toBe(claude);
      }
      expect(await stat(join(out, "plugins/omnilogic-labs/.os")).catch(() => null)).toBeNull();
    }
  });

  test("an unknown --os exits non-zero naming the allowed values", async () => {
    const p = Bun.spawnSync([
      "bun",
      BUILD,
      "--src",
      join(FIX, "src"),
      "--out",
      await tmp(),
      "--os",
      "beos",
    ]);
    expect(p.exitCode).not.toBe(0);
    expect(p.stderr.toString()).toContain("linux, wsl, macos, windows, any");
  });

  test("--check compares only the committed tree, whatever --os is", async () => {
    const out = await tmp();
    expect(await build(join(FIX, "src"), out, "linux")).toEqual([]);
    const p = Bun.spawnSync([
      "bun",
      BUILD,
      "--src",
      join(FIX, "src"),
      "--out",
      out,
      "--os",
      "windows",
      "--check",
    ]);
    expect(p.exitCode).toBe(0);
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
    expect(await diffCommittedTrees(out, out)).toEqual([]);
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

describe("portable root skills/", () => {
  const get = async () => {
    const { out, errors } = await compile(join(FIX, "src"), "linux");
    expect(errors).toEqual([]);
    return (p: string) => {
      const f = out.get(p);
      return f === undefined ? undefined : typeof f.data === "string" ? f.data : f.data;
    };
  };

  test("dispatcher shape", async () => {
    const g = await get();
    const text = g("skills/demo/SKILL.md") as string;
    const [, fm, body] = text.split(/^---\n/m);
    expect(fm.match(/^[a-z-]+(?=:)/gm)).toEqual(["name", "description"]);
    expect(body.trimEnd().split("\n").length).toBeLessThanOrEqual(15);
    for (const h of HOST_NAMES) expect(body).toContain(`\`platforms/${h}.md\``);
    expect(body).toContain("Any other agent: `platforms/codex.md`");
    expect(body).toContain("ignore the other platform files");
    expect(body).toContain("When `platforms/<host>/<path>` exists");
    const claude = g("plugins/omnilogic-labs/skills/demo/SKILL.md") as string;
    expect(g("skills/demo/platforms/claude.md")).toBe(
      claude.split(/^---\n/m)[2].replace(/^\n+/, "")
    );
    expect(g("skills/demo/platforms/codex.md")).toContain("Dispatch with `spawn_agent`.");
    expect(g("skills/demo/platforms/agy.md")).toContain("Dispatch with `invoke_subagent`.");
  });

  test("a reference with a host block lands under platforms/<host>/", async () => {
    const g = await get();
    expect(g("skills/demo/references/hosts.md")).toBeUndefined();
    expect(g("skills/demo/platforms/claude/references/hosts.md")).toContain("`Agent`");
    expect(g("skills/demo/platforms/codex/references/hosts.md")).toContain("`spawn_agent`");
    expect(g("skills/demo/platforms/agy/references/hosts.md")).toContain("`invoke_subagent`");
  });

  test("a reference without one lands once, rendered any-OS", async () => {
    const g = await get();
    expect(g("skills/demo/references/plain.md")).toBeDefined();
    expect(g("skills/demo/references/models.md")).toContain("gpt-6.1-sol");
    expect(g("skills/demo/references/os.md")).toContain("On Windows (Git Bash):");
    for (const h of HOST_NAMES) {
      expect(g(`skills/demo/platforms/${h}/references/plain.md`)).toBeUndefined();
      expect(g(`skills/demo/platforms/${h}/references/os.md`)).toBeUndefined();
    }
    expect(g("skills/demo/scripts/run.sh")).toBeDefined();
  });

  test("an exec-bit mismatch fails --check", async () => {
    const out = await tmp();
    expect(await build(join(FIX, "src"), out)).toEqual([]);
    const check = () =>
      Bun.spawnSync(["bun", BUILD, "--src", join(FIX, "src"), "--out", out, "--check"]);
    expect(check().exitCode).toBe(0);
    for (const p of [
      "skills/demo/scripts/run.sh",
      "plugins/omnilogic-labs/skills/demo/scripts/run.sh",
    ]) {
      await chmod(join(out, p), 0o644);
      const res = check();
      expect(res.exitCode).toBe(1);
      expect(res.stdout.toString()).toContain(`${p} (executable bit missing`);
      await chmod(join(out, p), 0o755);
    }
    expect(check().exitCode).toBe(0);
  });
});

describe("role prompts", () => {
  const SRC = join(import.meta.dir, "..", "..", "src");
  const text = (d: string | Uint8Array | undefined) =>
    d === undefined ? undefined : typeof d === "string" ? d : new TextDecoder().decode(d);
  const bodyOf = (agentMd: string) => agentMd.replace(/^---\n[\s\S]*?\n---\n+/, "");

  test("the coordinator skill carries roles/<role>.md with each agent's rendered body", async () => {
    const { out, errors } = await compile(SRC);
    expect(errors).toEqual([]);
    for (const role of ROLE_PROMPTS) {
      for (const h of HOST_NAMES) {
        const root = HOSTS[h].root;
        const got = text(out.get(`${root}/skills/${ROLE_SKILL}/roles/${role}.md`)?.data);
        const agent = text(out.get(`${root}/agents/${role}.md`)?.data);
        expect(got).toBeDefined();
        expect(got!.startsWith("---")).toBe(false);
        // Claude and agy agent files carry frontmatter; Codex's .md is the bare body copy.
        expect(got).toBe(bodyOf(agent!));
      }
      const once = out.get(`skills/${ROLE_SKILL}/roles/${role}.md`);
      const perHost = HOST_NAMES.every((h) =>
        out.has(`skills/${ROLE_SKILL}/platforms/${h}/roles/${role}.md`)
      );
      expect(Boolean(once) !== perHost).toBe(true);
      if (once) {
        expect(text(once.data)).toBe(
          text(out.get(`${HOSTS.claude.root}/skills/${ROLE_SKILL}/roles/${role}.md`)!.data)
        );
      }
    }
    expect(ROLE_PROMPTS).toEqual(["planner", "builder", "verifier"]);
  });

  test("a Claude-only agent is not rendered for other hosts", async () => {
    const { out, errors } = await compile(SRC);
    expect(errors).toEqual([]);
    expect(out.has(`${HOSTS.claude.root}/agents/external-runner.md`)).toBe(true);
    expect(out.has(`${HOSTS.codex.root}/agents/external-runner.toml`)).toBe(false);
    expect(out.has(`${HOSTS.agy.root}/agents/external-runner.md`)).toBe(false);
  });
});
