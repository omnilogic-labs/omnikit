// Pure template rendering: {{var}} substitution and line-level <!-- @if ... --> blocks on two
// axes, host and OS.

import { OS_NAMES, type OsName, type OsTarget, osLabel, osVars } from "./os";

export interface RenderError {
  file: string;
  line: number;
  message: string;
}

export type RenderResult = { ok: true; text: string } | { ok: false; errors: RenderError[] };

export interface RenderOptions {
  /** Host being rendered. */
  host: string;
  /** OS being rendered; "any" (the default) keeps every OS block under its label line. */
  os?: OsTarget;
  /** Vars for this host. {{os.*}} vars come from os.ts, not from here. */
  vars: Record<string, string>;
  /** Source path, for error messages. */
  file: string;
  /** Every known host name. */
  hosts: readonly string[];
}

const DIRECTIVE = /^(\s*)<!--\s*@(\S+)(.*?)-->\s*$/;
const VAR = /\{\{\s*([^{}\s]*)\s*\}\}/g;

export function formatError(e: RenderError): string {
  return `${e.file}:${e.line}: ${e.message}`;
}

interface Condition {
  hosts: string[] | null;
  oses: OsName[] | null;
}

/**
 * Parse the argument of an @if: up to two space-separated comma lists, one per axis, in any
 * order. Commas are OR within an axis; the two lists are ANDed.
 */
function parseCondition(rest: string, hosts: readonly string[]): Condition | string[] {
  const problems: string[] = [];
  const lists = rest
    .trim()
    .replace(/\s*,\s*/g, ",")
    .split(/\s+/)
    .filter(Boolean);
  if (lists.length === 0) return ["@if names no host or OS"];
  if (lists.length > 2) {
    return [`@if takes at most two lists (one of hosts, one of OSes), got ${lists.length}`];
  }
  const cond: Condition = { hosts: null, oses: null };
  for (const list of lists) {
    const names = list.split(",").filter(Boolean);
    const isHost = names.map((n) => hosts.includes(n));
    const isOs = names.map((n) => (OS_NAMES as string[]).includes(n));
    const anyHost = isHost.some(Boolean);
    const anyOs = isOs.some(Boolean);
    if (anyHost && anyOs) {
      problems.push(
        `@if list "${list}" mixes hosts and OSes; put each axis in its own list, separated by a space`
      );
      continue;
    }
    const axis = anyOs ? "OS" : anyHost ? "host" : "host or OS";
    const unknown = names.filter((_, i) => !isHost[i] && !isOs[i]);
    for (const n of unknown) {
      problems.push(
        `unknown ${axis} "${n}" in @if (hosts: ${hosts.join(", ")}; OSes: ${OS_NAMES.join(", ")})`
      );
    }
    if (unknown.length) continue;
    const key = anyOs ? "oses" : "hosts";
    if (cond[key]) {
      problems.push(`@if has two ${anyOs ? "OS" : "host"} lists; join them with commas`);
      continue;
    }
    if (anyOs) cond.oses = names as OsName[];
    else cond.hosts = names;
  }
  return problems.length ? problems : cond;
}

interface Open {
  line: number;
  keep: boolean;
  /** The OS whose {{os.*}} vars resolve inside this block under any-OS rendering. */
  os: OsName | null;
  /** True when the block names OSes, so {{os.*}} inside it is not "outside an OS block". */
  hasOs: boolean;
}

/**
 * Render `text` for one host and OS. Directive lines are dropped; lines inside an @if block that
 * does not match are dropped; {{name}} is replaced from the vars. Under os "any", a matching block
 * that names OSes is kept and preceded by its label line ("On Linux and WSL:"). A text with no
 * directives and no vars comes back byte-identical.
 */
export function render(text: string, opts: RenderOptions): RenderResult {
  const { host, vars, file, hosts } = opts;
  const os = opts.os ?? "any";
  const errors: RenderError[] = [];
  const out: string[] = [];
  const lines = text.split(/(?<=\n)/);
  const fileOsVars = os === "any" ? null : osVars(os);
  let open: Open | null = null;

  const lookup = (name: string, lineNo: number): string | null => {
    if (name.startsWith("os.")) {
      const ctx = fileOsVars ?? (open?.os ? osVars(open.os) : null);
      if (ctx && Object.hasOwn(ctx, name)) return ctx[name];
      if (!ctx) {
        const where = open?.hasOs
          ? "inside a block that names more than one OS"
          : "outside an OS block";
        errors.push({
          file,
          line: lineNo,
          message: `{{${name}}} ${where} has no single OS under any-OS rendering; use it inside a one-OS @if block`,
        });
        return null;
      }
    } else if (Object.hasOwn(vars, name)) return vars[name];
    errors.push({ file, line: lineNo, message: `unknown var {{${name}}}` });
    return null;
  };

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const content = raw.replace(/\r?\n$/, "");
    const d = DIRECTIVE.exec(content);
    if (d) {
      const [, indent, kind, rest] = d;
      if (kind === "if") {
        if (open) {
          errors.push({
            file,
            line: lineNo,
            message: `nested @if (the @if on line ${open.line} is still open)`,
          });
          return;
        }
        const cond = parseCondition(rest, hosts);
        if (Array.isArray(cond)) {
          for (const message of cond) errors.push({ file, line: lineNo, message });
          open = { line: lineNo, keep: false, os: null, hasOs: false };
          return;
        }
        const hostOk = cond.hosts === null || cond.hosts.includes(host);
        const osOk = cond.oses === null || os === "any" || cond.oses.includes(os);
        const keep = hostOk && osOk;
        open = {
          line: lineNo,
          keep,
          os: os === "any" && cond.oses?.length === 1 ? cond.oses[0] : null,
          hasOs: cond.oses !== null,
        };
        if (keep && os === "any" && cond.oses) {
          out.push(indent + osLabel(cond.oses) + (raw.slice(content.length) || "\n"));
        }
        return;
      }
      if (kind === "endif") {
        if (rest.trim()) {
          errors.push({ file, line: lineNo, message: "@endif takes no arguments" });
        }
        if (!open) {
          errors.push({ file, line: lineNo, message: "@endif without @if" });
        }
        open = null;
        return;
      }
      errors.push({ file, line: lineNo, message: `unknown directive @${kind}` });
      return;
    }
    if (open && !open.keep) return;
    out.push(raw.replace(VAR, (m, name: string) => lookup(name, lineNo) ?? m));
  });

  if (open) {
    errors.push({
      file,
      line: (open as Open).line,
      message: "unclosed @if (no @endif before end of file)",
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true, text: out.join("") };
}

// ---------- frontmatter ----------

export interface Frontmatter {
  /** Raw frontmatter lines between the --- fences, each keeping its line ending. */
  blocks: { key: string; lines: string[] }[];
  /** Everything after the closing fence. */
  body: string;
  /** Opening and closing fence lines, as written. */
  open: string;
  close: string;
}

/** Split a markdown file into top-level frontmatter key blocks and body. Null if none. */
export function splitFrontmatter(text: string): Frontmatter | null {
  const lines = text.split(/(?<=\n)/);
  if (lines.length === 0 || lines[0].replace(/\r?\n$/, "") !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.replace(/\r?\n$/, "") === "---");
  if (end < 0) return null;
  const blocks: Frontmatter["blocks"] = [];
  for (const l of lines.slice(1, end)) {
    const m = /^([A-Za-z0-9_-]+)\s*:/.exec(l);
    if (m) blocks.push({ key: m[1], lines: [l] });
    else if (blocks.length) blocks[blocks.length - 1].lines.push(l);
    else blocks.push({ key: "", lines: [l] });
  }
  return { blocks, body: lines.slice(end + 1).join(""), open: lines[0], close: lines[end] };
}

export function joinFrontmatter(fm: Frontmatter): string {
  return fm.open + fm.blocks.flatMap((b) => b.lines).join("") + fm.close + fm.body;
}

/** Keep only the listed top-level frontmatter keys. null keeps everything (byte-identical). */
export function filterFrontmatter(text: string, keep: readonly string[] | null): string {
  if (keep === null) return text;
  const fm = splitFrontmatter(text);
  if (!fm) return text;
  fm.blocks = fm.blocks.filter((b) => b.key === "" || keep.includes(b.key));
  return joinFrontmatter(fm);
}

// ---------- TOML ----------

/** A TOML basic string (single or multi-line) holding `s` exactly. */
export function tomlString(s: string, multiline = false): string {
  const esc = (ch: string) => {
    switch (ch) {
      case "\\":
        return "\\\\";
      case '"':
        return '\\"';
      case "\b":
        return "\\b";
      case "\t":
        return "\\t";
      case "\f":
        return "\\f";
      case "\r":
        return "\\r";
      case "\n":
        return multiline ? "\n" : "\\n";
      default:
        return "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
    }
  };
  const body = s.replace(/[\\"\u0000-\u001f\u007f]/g, esc);
  // A newline right after the opening """ is trimmed by TOML, so start the content on the next line.
  return multiline ? `"""\n${body}"""` : `"${body}"`;
}
