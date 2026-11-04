// Process facts omsg needs: parent pid, a start time that tells a reused pid
// apart from the original process, and the names it runs under. Linux reads
// /proc; macOS and Windows take one process-table snapshot and reuse it briefly.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { TOOLS, type Tool } from "./paths";

export type Proc = { pid: number; ppid: number; start: string; names: string[] };

const base = (s: string) =>
  basename(s.replace(/\\/g, "/")).replace(/\.(exe|cmd|bat|js|mjs|cjs)$/i, "");

function linuxProc(pid: number): Proc | null {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
  const close = stat.lastIndexOf(")");
  const comm = stat.slice(stat.indexOf("(") + 1, close);
  // Fields after the command: [0] state (field 3), [1] ppid (4), [19] starttime (22).
  const f = stat.slice(close + 2).split(" ");
  if (f[0] === "Z" || f[0] === "X") return null;
  const names = [comm];
  try {
    const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
    names.push(...argv.slice(0, 2).map(base));
  } catch {}
  return { pid, ppid: Number(f[1]), start: f[19], names };
}

let snap: { at: number; table: Map<number, Proc> } | null = null;

function run(cmd: string[]): string | null {
  try {
    const r = Bun.spawnSync(cmd, { stdin: "ignore", stderr: "ignore" });
    return r.exitCode === 0 ? r.stdout.toString() : null;
  } catch {
    return null;
  }
}

function darwinTable(): Map<number, Proc> {
  const t = new Map<number, Proc>();
  const out = run(["ps", "-A", "-o", "pid=", "-o", "ppid=", "-o", "lstart=", "-o", "comm="]);
  for (const line of (out || "").split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/);
    if (m) {
      const pid = Number(m[1]);
      t.set(pid, {
        pid,
        ppid: Number(m[2]),
        start: m[3].replace(/\s+/g, " "),
        names: [base(m[4])],
      });
    }
  }
  return t;
}

function windowsTable(): Map<number, Proc> {
  const t = new Map<number, Proc>();
  const ps =
    "Get-CimInstance Win32_Process | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.ProcessId,$_.ParentProcessId,$_.CreationDate.ToFileTimeUtc(),$_.Name }";
  let out = run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps]);
  if (out) {
    for (const line of out.split(/\r?\n/)) {
      const [pid, ppid, start, name] = line.trim().split("|");
      if (pid && name) {
        t.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), start, names: [base(name)] });
      }
    }
    return t;
  }
  out = run([
    "wmic",
    "process",
    "get",
    "CreationDate,Name,ParentProcessId,ProcessId",
    "/format:csv",
  ]);
  for (const line of (out || "").split(/\r?\n/)) {
    const [, start, name, ppid, pid] = line.trim().split(",");
    if (pid && /^\d+$/.test(pid)) {
      t.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), start, names: [base(name)] });
    }
  }
  return t;
}

function table(): Map<number, Proc> {
  if (snap && Date.now() - snap.at < 1000) return snap.table;
  const t = process.platform === "win32" ? windowsTable() : darwinTable();
  snap = { at: Date.now(), table: t };
  return t;
}

export function procInfo(pid: number): Proc | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === "linux") return linuxProc(pid);
  return table().get(pid) || null;
}

export function pidStart(pid: number): string | null {
  return procInfo(pid)?.start ?? null;
}

/** True while `pid` runs and, when `start` is given, is the same process that had that start time. */
export function isAlive(pid: number, start?: string | null): boolean {
  const p = procInfo(pid);
  if (p) return !start || p.start === start;
  if (process.platform === "linux" || !Number.isInteger(pid) || pid <= 0) return false;
  // No process table on this machine: fall back to a signal probe (cannot check reuse).
  if (table().size > 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The ancestors of `pid`, nearest first, `pid` itself excluded. */
export function ancestors(pid: number = process.pid, max = 64): Proc[] {
  const out: Proc[] = [];
  let cur = procInfo(pid);
  const seen = new Set<number>([pid]);
  while (cur && cur.ppid > 0 && !seen.has(cur.ppid) && out.length < max) {
    seen.add(cur.ppid);
    const parent = procInfo(cur.ppid);
    if (!parent) break;
    out.push(parent);
    cur = parent;
  }
  return out;
}

export function toolOf(p: Proc): Tool | null {
  for (const n of p.names) if ((TOOLS as readonly string[]).includes(n)) return n as Tool;
  return null;
}
