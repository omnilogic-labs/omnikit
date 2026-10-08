// Pure template rendering: {{var}} substitution and line-level <!-- @if host --> blocks.

export interface RenderError {
  file: string;
  line: number;
  message: string;
}

export type RenderResult = { ok: true; text: string } | { ok: false; errors: RenderError[] };

const DIRECTIVE = /^\s*<!--\s*@(\S+)(.*?)-->\s*$/;
const VAR = /\{\{\s*([^{}\s]*)\s*\}\}/g;

export function formatError(e: RenderError): string {
  return `${e.file}:${e.line}: ${e.message}`;
}

/**
 * Render `text` for `host`. Directive lines are dropped; lines inside an @if block for other
 * hosts are dropped; {{name}} is replaced from `vars`. A text with no directives and no vars
 * comes back byte-identical.
 */
export function render(
  text: string,
  host: string,
  vars: Record<string, string>,
  file: string,
  knownHosts: readonly string[]
): RenderResult {
  const errors: RenderError[] = [];
  const out: string[] = [];
  const lines = text.split(/(?<=\n)/);
  let open: { line: number; keep: boolean } | null = null;

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const content = raw.replace(/\r?\n$/, "");
    const d = DIRECTIVE.exec(content);
    if (d) {
      const [, kind, rest] = d;
      if (kind === "if") {
        const names = rest
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (open) {
          errors.push({
            file,
            line: lineNo,
            message: `nested @if (the @if on line ${open.line} is still open)`,
          });
          return;
        }
        if (names.length === 0) {
          errors.push({ file, line: lineNo, message: "@if names no host" });
        }
        for (const n of names) {
          if (!knownHosts.includes(n)) {
            errors.push({
              file,
              line: lineNo,
              message: `unknown host "${n}" in @if (known: ${knownHosts.join(", ")})`,
            });
          }
        }
        open = { line: lineNo, keep: names.includes(host) };
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
    out.push(
      raw.replace(VAR, (m, name: string) => {
        if (Object.hasOwn(vars, name)) return vars[name];
        errors.push({ file, line: lineNo, message: `unknown var {{${name}}}` });
        return m;
      })
    );
  });

  if (open) {
    errors.push({
      file,
      line: (open as { line: number }).line,
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
