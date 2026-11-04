// Pure helpers for omsg mail in the Claude Code mod (register.tsx). omsg is a
// local message CLI (plugins/omnilogic-labs/bin/omsg); the mod runs it and
// hands what it prints to the session.

// How often the session looks for new mail.
export const MAIL_POLL_MS = 30_000;
// The most messages one delivery hands the session; the rest wait for omsg read.
export const MAIL_MAX = 10;
export const ARTIFACT_URL = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/;

// Told to the session once, when it starts.
export const MAIL_RULE =
  "Mail from other agents and the owner arrives in your context automatically as " +
  "`omsg from <sender> [<id>]: <body>` lines; never poll for it.\n" +
  "Reply with `omsg reply <id> <text>`; send with `omsg send <to> <text>` " +
  "(to: `owner`, a name from `omsg who`, `@<project>`, `all`).";

// What `omsg hook start --host claude` prints: this session's name and the
// files whose mtimes say when mail arrived and when it was last read.
export type MailPaths = {
  name: string;
  notify: string;
  seen: string;
  ownerNotify: string;
  ownerSeen: string;
};

export type MailRecord = {
  id: string;
  ts: string;
  from: string;
  to: string;
  thread: string;
  body: string;
};

const s = (v: unknown) => (typeof v === "string" ? v : "");

// The JSON line `omsg hook start` prints, or null when it printed something else.
export function parseHookStart(stdout: string): MailPaths | null {
  const line = stdout
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("{"));
  if (line === undefined) return null;
  try {
    const o = JSON.parse(line) as Record<string, unknown>;
    const paths: MailPaths = {
      name: s(o.name),
      notify: s(o.notify),
      seen: s(o.seen),
      ownerNotify: s(o.ownerNotify),
      ownerSeen: s(o.ownerSeen),
    };
    return paths.name === "" || paths.notify === "" ? null : paths;
  } catch {
    return null;
  }
}

// The records `omsg read --json` prints; [] for anything that is not an array.
export function parseRecords(stdout: string): MailRecord[] {
  try {
    const list = JSON.parse(stdout.trim() || "[]") as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .filter((r): r is Record<string, unknown> => r !== null && typeof r === "object")
      .map((r) => ({
        id: s(r.id),
        ts: s(r.ts),
        from: s(r.from),
        to: s(r.to),
        thread: s(r.thread),
        body: s(r.body),
      }));
  } catch {
    return [];
  }
}

// The delivered mail text: one line per message, then how many wait unread.
export function deliveredText(records: readonly MailRecord[], more: number): string {
  const lines = records.map((r) => `omsg from ${r.from} [${r.id}]: ${r.body}`);
  if (more > 0) lines.push(`(+${more} more: omsg read)`);
  return lines.join("\n");
}

// What `omsg count` prints: a number, or nothing at 0.
export function parseCount(stdout: string): number {
  const n = Number.parseInt(stdout.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// The omsg arguments for a /mail command line, run as the owner, or a usage
// string when the line is not one /mail knows.
export function mailArgs(args: string): string[] | string {
  const line = args.trim();
  if (line === "") return ["--as", "owner", "read"];
  const m = /^(reply|send)\s+(\S+)\s+([\s\S]+)$/.exec(line);
  if (m === null) return "Usage: /mail, /mail reply <id> <text>, or /mail send <to> <text>";
  return ["--as", "owner", m[1] ?? "", m[2] ?? "", (m[3] ?? "").trim()];
}

// True when a Bash command is one plain omsg call: no chaining, pipes,
// substitution or redirection, so allowing it allows nothing else.
export function isSingleOmsg(command: string): boolean {
  if (/[;&|`<>\n\r]|\$\(/.test(command)) return false;
  return /^\s*omsg(\s|$)/.test(command);
}

// The page title of a questionnaire page, or null when the HTML is not one.
export function questionnaireTitle(html: string): string | null {
  if (!html.includes('id="q-spec"')) return null;
  const m = /<title>([^<]*)<\/title>/.exec(html);
  const title = (m?.[1] ?? "").trim();
  return title
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}
