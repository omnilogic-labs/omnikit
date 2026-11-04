// The agent registry: one agents/<key>.json per agent session, plus live/<hostpid>
// so a bash fast path can map a host pid to its key without parsing JSON.
//
// Liveness is the host pid running as the same process (its start time matches),
// never how recently a hook fired: an idle Codex or agy session fires none.
// lastSeen is for display and for pruning entries that are already dead.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import {
  ensureDirs,
  fullName,
  keyOf,
  localHost,
  OWNER_WORDS,
  paths,
  root,
  touchNotify,
  type Tool,
} from "./paths";
import { isAlive, pidStart } from "./proc";

export type Agent = {
  name: string;
  alias?: string;
  tool: Tool;
  host: string;
  project: string;
  cwd: string;
  sid: string;
  pid: number;
  pidStart: string | null;
  started: string;
  lastSeen: string;
  /** Full names whose mail this agent took over by claiming their alias. */
  inherits?: string[];
};

export type Entry = Agent & { key: string; live: boolean };

/** How long a dead entry that holds an alias keeps queueing mail before it is pruned. */
export const OFFLINE_KEEP_MS = 7 * 24 * 3600_000;
/** An entry from another host (shared storage) counts as live this long after lastSeen. */
export const REMOTE_LIVE_MS = 3600_000;

export function writeAtomic(path: string, data: string): void {
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export function isLive(a: Agent, now = Date.now()): boolean {
  if (a.host !== localHost()) return now - Date.parse(a.lastSeen) < REMOTE_LIVE_MS;
  return isAlive(a.pid, a.pidStart);
}

export function readAgent(key: string): Agent | null {
  try {
    const a = JSON.parse(readFileSync(paths.agent(key), "utf8"));
    return a && typeof a.name === "string" ? a : null;
  } catch {
    return null;
  }
}

export function saveAgent(a: Agent): void {
  ensureDirs();
  const { key: _k, live: _l, ...plain } = a as Partial<Entry>;
  writeAtomic(paths.agent(keyOf(a.name)), JSON.stringify(plain) + "\n");
}

export function listAgents(): Entry[] {
  let files: string[] = [];
  try {
    files = readdirSync(paths.agents()).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: Entry[] = [];
  for (const f of files) {
    const key = f.slice(0, -5);
    const a = readAgent(key);
    if (a) out.push({ ...a, key, live: isLive(a) });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

function dropLive(a: Agent): void {
  try {
    if (readFileSync(paths.live(a.pid), "utf8").trim() === keyOf(a.name)) rmSync(paths.live(a.pid));
  } catch {}
}

export function removeAgent(a: Agent): void {
  dropLive(a);
  rmSync(paths.agent(keyOf(a.name)), { force: true });
}

/**
 * Drop dead entries. A dead entry with an alias stays (mail to it queues) until
 * its lastSeen is older than OFFLINE_KEEP_MS. Returns the entries that remain.
 */
export function prune(entries: Entry[] = listAgents(), now = Date.now()): Entry[] {
  const keep: Entry[] = [];
  for (const e of entries) {
    if (e.live) {
      keep.push(e);
      continue;
    }
    dropLive(e);
    const old = now - Date.parse(e.lastSeen) > OFFLINE_KEEP_MS;
    if (e.alias && !old) keep.push(e);
    else rmSync(paths.agent(e.key), { force: true });
  }
  return keep;
}

export function projectOf(cwd: string): string {
  try {
    const top = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (top) return basename(top);
  } catch {}
  return basename(cwd) || "root";
}

export function validAlias(alias: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(alias)) {
    return "an alias is letters, digits, dot, dash or underscore, starting with a letter or digit";
  }
  if (alias === "all" || OWNER_WORDS.includes(alias)) return `"${alias}" is reserved`;
  return null;
}

/**
 * Give `self` the alias. A live holder refuses; a dead holder hands over its alias,
 * its read watermark and its unread mail.
 */
export function setAlias(self: Agent, alias: string, entries: Entry[] = listAgents()): Agent {
  const bad = validAlias(alias);
  if (bad) throw new Error(bad);
  const holders = entries.filter((e) => e.alias === alias && e.name !== self.name);
  const live = holders.find((e) => e.live);
  if (live) throw new Error(`alias "${alias}" is held by live agent ${live.name}`);
  const next: Agent = { ...self, alias };
  for (const h of holders) {
    next.inherits = [...new Set([...(next.inherits || []), h.name, ...(h.inherits || [])])];
    mergeSeen(keyOf(self.name), h.key);
    removeAgent(h);
  }
  saveAgent(next);
  return next;
}

// Kept here, not in store.ts, so registry has no dependency cycle.
function mergeSeen(intoKey: string, fromKey: string): void {
  const read = (k: string) => {
    try {
      return JSON.parse(readFileSync(paths.seen(k), "utf8"));
    } catch {
      return null;
    }
  };
  const from = read(fromKey);
  const into = read(intoKey);
  const fromPending = pendingByMtime(fromKey);
  if (from) {
    // Start each sender log at the earlier of the two offsets (a log missing
    // from either side starts at 0), so neither name's unread mail is skipped.
    let offsets: Record<string, number> = { ...(from.offsets || {}) };
    const ids: Record<string, string[]> = { ...(from.ids || {}) };
    if (into) {
      const mine: Record<string, number> = into.offsets || {};
      offsets = Object.fromEntries(
        Object.entries(offsets)
          .filter(([k]) => k in mine)
          .map(([k, v]) => [k, Math.min(v, mine[k])])
      );
      for (const [k, v] of Object.entries(into.ids || {}) as [string, string[]][]) {
        ids[k] = [...new Set([...(ids[k] || []), ...v])].slice(-200);
      }
    }
    writeAtomic(paths.seen(intoKey), JSON.stringify({ offsets, ids }) + "\n");
  } else if (into) {
    // The old holder never read anything: rescan from the start for its mail.
    writeAtomic(paths.seen(intoKey), JSON.stringify({ offsets: {}, ids: into.ids || {} }) + "\n");
  }
  if (fromPending || from || into) {
    // Make the next read scan: seen older than notify.
    touchNotify(intoKey);
    if (existsSync(paths.seen(intoKey))) utimesSync(paths.seen(intoKey), 0, 0);
  }
  rmSync(paths.seen(fromKey), { force: true });
  rmSync(paths.notify(fromKey), { force: true });
}

function pendingByMtime(key: string): boolean {
  try {
    const n = statSync(paths.notify(key), { bigint: true }).mtimeNs;
    try {
      return n > statSync(paths.seen(key), { bigint: true }).mtimeNs;
    } catch {
      return true;
    }
  } catch {
    return false;
  }
}

export type RegisterInput = {
  tool: Tool;
  sid: string;
  pid: number;
  cwd: string;
  project?: string;
  host?: string;
  alias?: string;
};

/**
 * Add or refresh the entry for a host session (the hooks call this). Keeps
 * started, alias and inherits across a resume; claims OMSG_NAME-style aliases
 * when no live agent holds them.
 */
export function register(input: RegisterInput): Agent {
  ensureDirs();
  const host = input.host || localHost();
  const project = input.project || projectOf(input.cwd);
  const name = fullName(input.tool, host, project, input.sid);
  const prev = readAgent(keyOf(name));
  const now = new Date().toISOString();
  let a: Agent = {
    name,
    alias: prev?.alias,
    tool: input.tool,
    host,
    project,
    cwd: input.cwd,
    sid: input.sid,
    pid: input.pid,
    pidStart: pidStart(input.pid),
    started: prev && prev.pid === input.pid ? prev.started : now,
    lastSeen: now,
    inherits: prev?.inherits,
  };
  if (!a.alias) delete a.alias;
  if (!a.inherits) delete a.inherits;
  saveAgent(a);
  writeAtomic(paths.live(input.pid), keyOf(name) + "\n");
  if (!existsSync(paths.seen(keyOf(name)))) startSeenAtEnd(keyOf(name));
  if (input.alias && input.alias !== a.alias) {
    try {
      a = setAlias(a, input.alias);
    } catch (e) {
      process.stderr.write(`omsg: ${(e as Error).message}; registered without alias\n`);
    }
  }
  return a;
}

// A new name has no mail yet, so its watermark starts at the end of every log
// and its first read does not rescan the whole history.
function startSeenAtEnd(key: string): void {
  const offsets: Record<string, number> = {};
  try {
    for (const f of readdirSync(root())) {
      const m = f.match(/^log-(.+)\.jsonl$/);
      if (m) offsets[m[1]] = statSync(join(root(), f)).size;
    }
  } catch {}
  writeAtomic(paths.seen(key), JSON.stringify({ offsets, ids: {} }) + "\n");
}

export function touchSeen(a: Agent): void {
  saveAgent({ ...a, lastSeen: new Date().toISOString() });
}

export function liveKeyFor(pid: number): string | null {
  if (!existsSync(paths.live(pid))) return null;
  try {
    return readFileSync(paths.live(pid), "utf8").trim() || null;
  } catch {
    return null;
  }
}
