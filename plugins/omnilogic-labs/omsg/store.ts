// Mail storage. Each sender appends to its own log-<key>.jsonl, one record per
// line, each written by a single appendFile of under 4 KB, so concurrent writers
// never interleave and no lock is needed. Readers keep per-sender byte offsets
// in seen/<key>, dedupe by (from, id), and leave a torn last line for later.
import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  utimesSync,
} from "node:fs";
import { display, ensureDirs, keyOf, paths, root, touchNotify } from "./paths";
import { writeAtomic } from "./registry";

export type Rec = {
  id: string;
  ts: string;
  from: string;
  to: string;
  thread: string;
  body: string;
};

/** Longest record line, newline included. One write of this size never interleaves. */
export const LINE_MAX = 4096;
/** Ids per sender kept in seen/<key> to dedupe records that show up again. */
const IDS_KEPT = 200;

export class TooLong extends Error {}

export function recordId(from: string, ts: string, to: string, body: string): string {
  return createHash("sha256").update(`${from}\n${ts}\n${to}\n${body}`).digest("hex").slice(0, 8);
}

export function makeRecord(from: string, to: string, body: string, thread?: string): Rec {
  const ts = new Date().toISOString();
  const id = recordId(from, ts, to, body);
  return { id, ts, from, to, thread: thread || id, body };
}

export function encode(r: Rec): string {
  const line = JSON.stringify(r) + "\n";
  const n = Buffer.byteLength(line);
  if (n > LINE_MAX) {
    throw new TooLong(
      `message too long (${Buffer.byteLength(r.body)} byte body, ${n} byte record; the limit is ${LINE_MAX} per record). Write it to a file and send the path instead.`
    );
  }
  return line;
}

/** Append records (all checked first, so none is written if one is too long), then notify each recipient. */
export function append(recs: Rec[]): void {
  const lines = recs.map(encode);
  ensureDirs();
  recs.forEach((r, i) => appendFileSync(paths.log(keyOf(r.from)), lines[i]));
  for (const to of new Set(recs.map((r) => r.to))) touchNotify(keyOf(to));
}

export type Seen = { offsets: Record<string, number>; ids: Record<string, string[]> };

export function loadSeen(key: string): Seen {
  try {
    const s = JSON.parse(readFileSync(paths.seen(key), "utf8"));
    return { offsets: s.offsets || {}, ids: s.ids || {} };
  } catch {
    return { offsets: {}, ids: {} };
  }
}

function mtimeNs(path: string): bigint | null {
  try {
    return statSync(path, { bigint: true }).mtimeNs;
  } catch {
    return null;
  }
}

/**
 * The fast path: false when notify/<key> is not newer than seen/<key>, which
 * means no mail and no log needs opening. True means "maybe", so scan.
 */
export function maybeMail(key: string): boolean {
  const n = mtimeNs(paths.notify(key));
  if (n === null) return false;
  const s = mtimeNs(paths.seen(key));
  return s === null || n > s;
}

type Item = { rec: Rec; start: number; end: number };
type Log = { key: string; items: Item[]; end: number };

function logKeys(): string[] {
  try {
    return readdirSync(root())
      .map((f) => f.match(/^log-(.+)\.jsonl$/)?.[1])
      .filter((k): k is string => !!k)
      .sort();
  } catch {
    return [];
  }
}

const isRec = (r: any): r is Rec =>
  r &&
  typeof r === "object" &&
  ["id", "ts", "from", "to", "thread", "body"].every((k) => typeof r[k] === "string");

/** Read one log from `from`, returning complete records and the offset after the last complete line. */
export function readLog(key: string, from = 0): { recs: Item[]; end: number } {
  const fd = openSync(paths.log(key), "r");
  try {
    const size = fstatSync(fd).size;
    if (size <= from) return { recs: [], end: from };
    const buf = Buffer.alloc(size - from);
    let got = 0;
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, from + got);
      if (n <= 0) break;
      got += n;
    }
    const recs: Item[] = [];
    let pos = 0;
    while (pos < got) {
      const nl = buf.indexOf(0x0a, pos);
      if (nl < 0 || nl >= got) break; // torn or still being written: leave it for later
      const line = buf.subarray(pos, nl).toString("utf8").trim();
      if (line) {
        try {
          const r = JSON.parse(line);
          if (isRec(r)) recs.push({ rec: r, start: from + pos, end: from + nl + 1 });
        } catch {}
      }
      pos = nl + 1;
    }
    return { recs, end: from + pos };
  } finally {
    closeSync(fd);
  }
}

/** Unread mail to any of `names`, one queue per sender log, deduped by (from, id). */
function scan(names: string[], seen: Seen): Log[] {
  const want = new Set(names);
  const logs: Log[] = [];
  for (const key of logKeys()) {
    let got: ReturnType<typeof readLog>;
    try {
      got = readLog(key, seen.offsets[key] || 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw e;
    }
    const { recs, end } = got;
    // seen.ids[key] holds ids already delivered from this sender's log.
    const old = new Set(seen.ids[key] || []);
    const now = new Set<string>();
    const items: Item[] = [];
    for (const it of recs) {
      if (!want.has(it.rec.to)) continue;
      const k = `${it.rec.from}\0${it.rec.id}`;
      if (old.has(it.rec.id) || now.has(k)) continue;
      now.add(k);
      items.push(it);
    }
    logs.push({ key, items, end });
  }
  return logs;
}

export function countUnread(key: string, names: string[]): number {
  if (!maybeMail(key)) return 0;
  return scan(names, loadSeen(key)).reduce((n, l) => n + l.items.length, 0);
}

export type ReadOpts = { max?: number; budget?: number; advance?: boolean };

/**
 * Take up to `max` unread messages, oldest first across senders, and (unless
 * advance is false) move the watermark past exactly what was taken.
 */
export function takeUnread(
  key: string,
  names: string[],
  opts: ReadOpts = {}
): { recs: Rec[]; more: number } {
  const max = opts.max ?? Infinity;
  const budget = opts.budget ?? Infinity;
  const notifyBefore = mtimeNs(paths.notify(key));
  if (notifyBefore === null) return { recs: [], more: 0 };
  const seenBefore = mtimeNs(paths.seen(key));
  if (seenBefore !== null && notifyBefore <= seenBefore) return { recs: [], more: 0 };
  const seen = loadSeen(key);
  const logs = scan(names, seen);
  const heads = logs.map(() => 0);
  const recs: Rec[] = [];
  let used = 0;
  for (;;) {
    let best = -1;
    for (let i = 0; i < logs.length; i++) {
      const it = logs[i].items[heads[i]];
      if (it && (best < 0 || it.rec.ts < logs[best].items[heads[best]].rec.ts)) best = i;
    }
    if (best < 0 || recs.length >= max) break;
    const rec = logs[best].items[heads[best]].rec;
    if (recs.length > 0 && used + rec.body.length > budget) break;
    used += rec.body.length;
    recs.push(rec);
    heads[best]++;
  }
  const more = logs.reduce((n, l, i) => n + l.items.length - heads[i], 0);
  if (opts.advance === false) return { recs, more };
  for (let i = 0; i < logs.length; i++) {
    const l = logs[i];
    const next = l.items[heads[i]];
    seen.offsets[l.key] = next ? next.start : l.end;
    const taken = l.items.slice(0, heads[i]).map((it) => it.rec.id);
    if (taken.length) seen.ids[l.key] = [...(seen.ids[l.key] || []), ...taken].slice(-IDS_KEPT);
  }
  ensureDirs();
  writeAtomic(paths.seen(key), JSON.stringify(seen) + "\n");
  // seen's mtime records which notify it caught up with: the notify mtime seen
  // before scanning (a send during the scan leaves notify newer). With mail left
  // over, keep it older than notify so the fast path still reports mail.
  const secs = Number(notifyBefore) / 1e9 + (more > 0 ? -1 : 2e-6);
  utimesSync(paths.seen(key), secs, secs);
  return { recs, more };
}

/** Every record with this id, in any log. */
export function findById(id: string): Rec[] {
  const out: Rec[] = [];
  for (const key of logKeys()) {
    try {
      for (const it of readLog(key).recs) if (it.rec.id === id) out.push(it.rec);
    } catch {}
  }
  return out;
}

const oneLine = (s: string) => s.replace(/\r?\n/g, "\\n");

/** Delivered mail text: one line per message and, when some were held back, a final "(+N more: omsg read)". */
export function formatMail(recs: Rec[], more = 0): string {
  const lines = recs.map((r) => `omsg from ${display(r.from)} [${r.id}]: ${oneLine(r.body)}`);
  if (more > 0) lines.push(`(+${more} more: omsg read)`);
  return lines.join("\n");
}
