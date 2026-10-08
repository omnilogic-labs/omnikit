// Compile src/{skills,agents} into the Claude plugin tree and the Codex and agy trees.
//
//   bun scripts/build/build.ts [--src src] [--out .] [--os linux|wsl|macos|windows|any] [--check]
//
// Committed trees (the Claude plugin) always render any-OS: every OS block is kept under its label
// line. The machine-local trees (dist/<host>) render for --os (default any), and record it in
// dist/<host>/.os. The root skills/ tree (what `npx skills` installs) is committed too and renders
// any-OS: per skill, a dispatcher SKILL.md plus platforms/<host>.md bodies. --check builds into a
// temp dir and exits 1, listing every path under the committed trees (the Claude plugin and root
// skills/) whose content or executable bit differs from the fresh build.

import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import * as prettier from "prettier";
import { HOSTS, HOST_NAMES, type Host, type HostName, type Tier, varsFor } from "./hosts";
import { OS_TARGETS, type OsTarget, isOsTarget } from "./os";
import {
  filterFrontmatter,
  formatError,
  joinFrontmatter,
  render,
  splitFrontmatter,
  tomlString,
  type RenderError,
} from "./render";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const CLAUDE_ONLY_KEYS = new Set(["effort", "tools", "skills"]);
const SOURCE_ONLY_KEYS = new Set(["tier", "models", "hosts"]);

export interface OutFile {
  data: string | Uint8Array;
  mode: number;
}

export type Outputs = Map<string, OutFile>;

/** All files under dir, as paths relative to dir with forward slashes, skipping SKIP_DIRS. */
export async function walk(dir: string): Promise<string[]> {
  const found: string[] = [];
  async function go(d: string) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await go(p);
      } else if (e.isFile() || e.isSymbolicLink()) {
        // A symlink is read through and emitted as a plain file (Windows checks links out as text).
        const s = await stat(p).catch(() => null);
        if (s?.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) await go(p);
        } else if (s) found.push(relative(dir, p).split(sep).join("/"));
      }
    }
  }
  await go(dir);
  return found.sort();
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** True for trees built on the user's machine (dist/, gitignored); false for committed trees. */
export function isLocalTree(host: Host): boolean {
  return host.root.startsWith("dist/");
}

/** Committed trees render any-OS; local trees render for the OS install.sh detected. */
export function osForHost(host: Host, os: OsTarget): OsTarget {
  return isLocalTree(host) ? os : "any";
}

function renderFor(text: string, name: HostName, os: OsTarget, file: string) {
  return render(text, {
    host: name,
    os: osForHost(HOSTS[name], os),
    vars: varsFor(name),
    file,
    hosts: HOST_NAMES,
  });
}

function lineOfKey(text: string, key: string): number {
  const i = text.split("\n").findIndex((l) => l.startsWith(`${key}:`));
  return i < 0 ? 1 : i + 1;
}

// ---------- skills ----------

async function buildSkills(src: string, os: OsTarget, out: Outputs, errors: RenderError[]) {
  const root = join(src, "skills");
  for (const skill of await subdirs(root)) {
    const dir = join(root, skill);
    for (const rel of await walk(dir)) {
      const file = join(dir, rel);
      const s = await stat(file);
      const bytes = await readFile(file);
      const isMd = rel.endsWith(".md");
      const text = isMd ? bytes.toString("utf8") : "";
      for (const name of HOST_NAMES) {
        const host = HOSTS[name];
        const dest = `${host.root}/skills/${skill}/${rel}`;
        if (!isMd) {
          out.set(dest, { data: new Uint8Array(bytes), mode: s.mode });
          continue;
        }
        const r = renderFor(text, name, os, file);
        if (!r.ok) {
          errors.push(...r.errors);
          continue;
        }
        const data =
          rel === "SKILL.md" ? filterFrontmatter(r.text, host.skillFrontmatterKeys) : r.text;
        out.set(dest, { data, mode: s.mode });
      }
    }
  }
}

// ---------- agents ----------

interface AgentMeta {
  name: string;
  description: string;
  tier: Tier;
  models: Partial<Record<HostName, string>>;
  hosts: HostName[];
}

function parseAgentMeta(
  fmText: string,
  file: string,
  fullText: string,
  errors: RenderError[]
): AgentMeta | null {
  let raw: Record<string, unknown>;
  try {
    raw = (Bun.YAML.parse(fmText) ?? {}) as Record<string, unknown>;
  } catch (e) {
    errors.push({
      file,
      line: 1,
      message: `frontmatter is not valid YAML: ${(e as Error).message}`,
    });
    return null;
  }
  const bad = (key: string, message: string) => {
    errors.push({ file, line: lineOfKey(fullText, key), message });
    return null;
  };
  if (typeof raw.name !== "string" || !raw.name) return bad("name", "agent needs a name");
  if (typeof raw.description !== "string" || !raw.description) {
    return bad("description", "agent needs a description");
  }
  if (raw.model !== undefined) return bad("model", "agent sources use tier:, not model:");
  if (raw.tier !== "deep" && raw.tier !== "fast") return bad("tier", "tier must be deep or fast");
  const models = (raw.models ?? {}) as Record<string, unknown>;
  if (typeof models !== "object" || Array.isArray(models)) {
    return bad("models", "models must be a map of host to model");
  }
  for (const [h, m] of Object.entries(models)) {
    if (!HOST_NAMES.includes(h as HostName)) return bad("models", `unknown host "${h}" in models`);
    if (typeof m !== "string") return bad("models", `models.${h} must be a string`);
  }
  const hosts = (raw.hosts ?? HOST_NAMES) as unknown;
  if (!Array.isArray(hosts) || hosts.length === 0) {
    return bad("hosts", "hosts must be a non-empty list");
  }
  for (const h of hosts) {
    if (!HOST_NAMES.includes(h as HostName)) return bad("hosts", `unknown host "${h}" in hosts`);
  }
  return {
    name: raw.name,
    description: raw.description,
    tier: raw.tier,
    models: models as Partial<Record<HostName, string>>,
    hosts: hosts as HostName[],
  };
}

function trimLeadingBlank(s: string): string {
  return s.replace(/^(\s*\r?\n)+/, "");
}

/** Emit one agent for one host. Returns the files keyed by output path. */
export function emitAgent(
  role: string,
  rendered: string,
  file: string,
  host: Host,
  errors: RenderError[]
): Outputs {
  const out: Outputs = new Map();
  const fm = splitFrontmatter(rendered);
  if (!fm) {
    errors.push({ file, line: 1, message: "agent has no frontmatter" });
    return out;
  }
  const fmText = fm.blocks.flatMap((b) => b.lines).join("");
  const meta = parseAgentMeta(fmText, file, rendered, errors);
  if (!meta || !meta.hosts.includes(host.name)) return out;
  const model = meta.models[host.name] ?? host.tier[meta.tier];
  const body = trimLeadingBlank(fm.body).replace(/\s+$/, "") + "\n";
  const base = `${host.root}/agents/${role}`;
  const mode = 0o644;

  if (host.agentFormat === "claude-md") {
    const blocks = fm.blocks.flatMap((b) =>
      b.key === "tier"
        ? [{ key: "model", lines: [`model: ${model}\n`] }]
        : SOURCE_ONLY_KEYS.has(b.key)
          ? []
          : [b]
    );
    out.set(`${base}.md`, { data: joinFrontmatter({ ...fm, blocks }), mode });
    return out;
  }

  if (host.agentFormat === "codex-toml") {
    const effort = host.effort?.[meta.tier];
    const toml =
      [
        `name = ${tomlString(meta.name)}`,
        `description = ${tomlString(meta.description.trim())}`,
        `model = ${tomlString(model)}`,
        ...(effort ? [`model_reasoning_effort = ${tomlString(effort)}`] : []),
        `developer_instructions = ${tomlString(body, true)}`,
      ].join("\n") + "\n";
    out.set(`${base}.toml`, { data: toml, mode });
    out.set(`${base}.md`, { data: body, mode });
    return out;
  }

  // agy: markdown with name, description (as written in the source) and a pro|flash|inherit model.
  const keep = fm.blocks.filter(
    (b) => !SOURCE_ONLY_KEYS.has(b.key) && !CLAUDE_ONLY_KEYS.has(b.key)
  );
  const blocks = [...keep, { key: "model", lines: [`model: ${model}\n`] }];
  out.set(`${base}.md`, { data: joinFrontmatter({ ...fm, blocks }), mode });
  return out;
}

async function buildAgents(src: string, os: OsTarget, out: Outputs, errors: RenderError[]) {
  const dir = join(src, "agents");
  const files = (await walk(dir)).filter((f) => f.endsWith(".md") && !f.includes("/"));
  for (const rel of files) {
    const file = join(dir, rel);
    const text = await readFile(file, "utf8");
    const role = rel.replace(/\.md$/, "");
    for (const name of HOST_NAMES) {
      const r = renderFor(text, name, os, file);
      if (!r.ok) {
        errors.push(...r.errors);
        continue;
      }
      for (const [k, v] of emitAgent(role, r.text, file, HOSTS[name], errors)) out.set(k, v);
    }
  }
}

// ---------- portable root skills/ ----------

/** Root of the portable tree that `npx skills` installs. Committed, so it renders any-OS. */
export const PORTABLE_ROOT = "skills";
/** Platform file that agents other than the three hosts read. */
export const PORTABLE_DEFAULT_HOST: HostName = "codex";

/** The short SKILL.md body that points each agent at its platform file. */
export function dispatcherBody(skill: string): string {
  const rows = HOST_NAMES.map((h) => `- ${HOSTS[h].label}: \`platforms/${h}.md\``);
  return [
    `# ${skill}`,
    "",
    "Read the file for your platform and ignore the other platform files:",
    "",
    ...rows,
    `- Any other agent: \`platforms/${PORTABLE_DEFAULT_HOST}.md\``,
    "",
    "Paths in your platform file are relative to this folder. When `platforms/<host>/<path>` exists,",
    "read it instead of `<path>` (`<host>` is your platform file's name without `.md`).",
    "",
  ].join("\n");
}

function decode(d: string | Uint8Array): string {
  return typeof d === "string" ? d : new TextDecoder().decode(d);
}

/**
 * Emit the portable tree: each skill rendered any-OS for every host. Non-.md files are copied
 * once; a rendered .md identical on every host lands once at its usual path, one that differs
 * lands at platforms/<host>/<path>. SKILL.md becomes a dispatcher plus platforms/<host>.md.
 */
async function buildPortable(src: string, out: Outputs, errors: RenderError[]) {
  const root = join(src, "skills");
  const cfg = await loadPrettierConfig();
  const fmt = (text: string, path: string) => prettier.format(text, { ...cfg, filepath: path });
  for (const skill of await subdirs(root)) {
    const dir = join(root, skill);
    const base = `${PORTABLE_ROOT}/${skill}`;
    for (const rel of await walk(dir)) {
      const file = join(dir, rel);
      const s = await stat(file);
      const bytes = await readFile(file);
      if (!rel.endsWith(".md")) {
        const data = rel.endsWith(".json")
          ? await fmt(bytes.toString("utf8"), `${base}/${rel}`)
          : new Uint8Array(bytes);
        out.set(`${base}/${rel}`, { data, mode: s.mode });
        continue;
      }
      const text = bytes.toString("utf8");
      const rendered: Partial<Record<HostName, string>> = {};
      for (const name of HOST_NAMES) {
        const r = render(text, {
          host: name,
          os: "any",
          vars: varsFor(name),
          file,
          hosts: HOST_NAMES,
        });
        if (!r.ok) {
          errors.push(...r.errors);
          continue;
        }
        rendered[name] = await fmt(r.text, `${base}/${rel}`);
      }
      if (Object.keys(rendered).length !== HOST_NAMES.length) continue;
      if (rel === "SKILL.md") {
        const claude = splitFrontmatter(rendered.claude!);
        if (!claude) {
          errors.push({ file, line: 1, message: "SKILL.md has no frontmatter" });
          continue;
        }
        const head = joinFrontmatter({
          ...claude,
          blocks: claude.blocks.filter((b) => b.key === "name" || b.key === "description"),
          body: "\n" + dispatcherBody(skill),
        });
        out.set(`${base}/SKILL.md`, { data: await fmt(head, `${base}/SKILL.md`), mode: s.mode });
        for (const name of HOST_NAMES) {
          const fm = splitFrontmatter(rendered[name]!);
          const body = trimLeadingBlank(fm ? fm.body : rendered[name]!);
          const path = `${base}/platforms/${name}.md`;
          out.set(path, { data: await fmt(body, path), mode: s.mode });
        }
        continue;
      }
      const texts = HOST_NAMES.map((h) => rendered[h]!);
      if (texts.every((t) => t === texts[0])) {
        out.set(`${base}/${rel}`, { data: texts[0], mode: s.mode });
      } else {
        for (const name of HOST_NAMES) {
          out.set(`${base}/platforms/${name}/${rel}`, { data: rendered[name]!, mode: s.mode });
        }
      }
    }
  }
}

// ---------- prettier ----------

let prettierConfig: prettier.Options | null = null;

async function loadPrettierConfig(): Promise<prettier.Options> {
  if (!prettierConfig) {
    const cfg = JSON.parse(await readFile(join(REPO_ROOT, ".prettierrc.json"), "utf8"));
    // Plugins (prettier-plugin-sh) only matter for shell files, which the build copies untouched.
    delete cfg.plugins;
    prettierConfig = cfg as prettier.Options;
  }
  return prettierConfig;
}

async function formatOutputs(out: Outputs) {
  const cfg = await loadPrettierConfig();
  for (const [path, f] of out) {
    if (!/\.(md|json)$/.test(path)) continue;
    const text = typeof f.data === "string" ? f.data : new TextDecoder().decode(f.data);
    const formatted = await prettier.format(text, { ...cfg, filepath: path });
    out.set(path, { ...f, data: formatted });
  }
}

// ---------- build ----------

/** Compile src into an in-memory file map. Throws nothing; returns errors instead. */
export async function compile(
  src: string,
  os: OsTarget = "any"
): Promise<{ out: Outputs; errors: string[] }> {
  const out: Outputs = new Map();
  const errs: RenderError[] = [];
  await buildSkills(src, os, out, errs);
  await buildAgents(src, os, out, errs);
  for (const name of HOST_NAMES) {
    const host = HOSTS[name];
    if (!isLocalTree(host)) continue;
    out.set(`${host.root}/.os`, { data: `${os}\n`, mode: 0o644 });
  }
  const errors = [...new Set(errs.map(formatError))];
  if (errors.length === 0) await formatOutputs(out);
  // Formatted on its own: buildPortable compares per-host renders after prettier.
  const portable: Outputs = new Map();
  if (errors.length === 0) await buildPortable(src, portable, errs);
  for (const [k, v] of portable) out.set(k, v);
  const all = [...new Set(errs.map(formatError))];
  return { out, errors: all };
}

export function outputDirs(): string[] {
  return [
    ...HOST_NAMES.flatMap((h) => [`${HOSTS[h].root}/skills`, `${HOSTS[h].root}/agents`]),
    PORTABLE_ROOT,
  ];
}

/** Generated dirs that are committed, and so compared by --check. */
export function committedDirs(): string[] {
  const claude = HOSTS.claude.root;
  return [`${claude}/skills`, `${claude}/agents`, PORTABLE_ROOT];
}

/** Build src into outDir. Wipes only the generated skills/ and agents/ dirs of each host. */
export async function build(src: string, outDir: string, os: OsTarget = "any"): Promise<string[]> {
  const { out, errors } = await compile(src, os);
  if (errors.length) return errors;
  for (const d of outputDirs()) await rm(join(outDir, d), { recursive: true, force: true });
  for (const d of outputDirs()) await mkdir(join(outDir, d), { recursive: true });
  for (const [path, f] of out) {
    const dest = join(outDir, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, f.data);
    await chmod(dest, f.mode & 0o777);
  }
  return [];
}

/** True when the file at rel (under dir) is executable. Windows asks git, which keeps the bit. */
async function isExecutable(dir: string, rel: string): Promise<boolean> {
  if (platform() === "win32") {
    const p = Bun.spawnSync(["git", "-C", dir, "ls-files", "-s", "--", rel]);
    const mode = p.stdout.toString().split(/\s/)[0];
    if (mode === "100755") return true;
    if (mode === "100644") return false;
  }
  const s = await stat(join(dir, rel));
  return (s.mode & 0o111) !== 0;
}

/**
 * Paths under the committed trees (Claude plugin skills/ and agents/, root skills/) whose content
 * or executable bit differs between a fresh build and the committed out dir.
 */
export async function diffCommittedTrees(
  builtDir: string,
  committedDir: string
): Promise<string[]> {
  const diffs: string[] = [];
  for (const sub of committedDirs()) {
    const a = join(builtDir, sub);
    const b = join(committedDir, sub);
    const files = [...new Set([...(await walk(a)), ...(await walk(b))])].sort();
    for (const f of files) {
      const [x, y] = await Promise.all([
        readFile(join(a, f)).catch(() => null),
        readFile(join(b, f)).catch(() => null),
      ]);
      const path = `${sub}/${f}`;
      if (!x) diffs.push(`${path} (not generated; remove it or add a source)`);
      else if (!y) diffs.push(`${path} (missing; run bun run build)`);
      else if (!x.equals(y)) diffs.push(`${path} (differs; run bun run build)`);
      else {
        const [ex, ey] = await Promise.all([
          isExecutable(builtDir, path),
          isExecutable(committedDir, path),
        ]);
        if (ex !== ey) {
          diffs.push(`${path} (executable bit ${ey ? "set" : "missing"}; run bun run build)`);
        }
      }
    }
  }
  return diffs;
}

function parseArgs(argv: string[]) {
  const opts = { src: "src", out: ".", check: false, os: "any" as OsTarget };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") opts.check = true;
    else if (a === "--os") {
      const v = argv[++i];
      if (!v || !isOsTarget(v)) {
        throw new Error(`--os must be one of ${OS_TARGETS.join(", ")} (got ${v ?? "nothing"})`);
      }
      opts.os = v;
    } else if (a === "--src" || a === "--out") {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a value`);
      opts[a === "--src" ? "src" : "out"] = v;
    } else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`build: ${(e as Error).message}`);
    console.error(
      `usage: bun scripts/build/build.ts [--src src] [--out .] [--os ${OS_TARGETS.join("|")}] [--check]`
    );
    process.exit(2);
  }
  if (opts.check) {
    const tmp = await mkdtemp(join(tmpdir(), "omnikit-build-"));
    try {
      const errors = await build(opts.src, tmp, opts.os);
      if (errors.length) {
        for (const e of errors) console.error(e);
        process.exit(1);
      }
      const diffs = await diffCommittedTrees(tmp, opts.out);
      if (diffs.length) {
        console.error(`build: ${diffs.length} generated file(s) out of date:`);
        for (const d of diffs) console.log(d);
        process.exit(1);
      }
      console.error("build: committed trees are up to date");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
    return;
  }
  const errors = await build(opts.src, opts.out, opts.os);
  if (errors.length) {
    for (const e of errors) console.error(e);
    console.error(`build: failed with ${errors.length} error(s); nothing written`);
    process.exit(1);
  }
  console.error(`build: wrote ${outputDirs().join(", ")} under ${opts.out} (dist OS: ${opts.os})`);
}

if (import.meta.main) await main();
