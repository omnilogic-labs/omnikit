// Storage layout and names. Every omsg file lives under one root:
//   log-<key>.jsonl   append-only records written by sender <key>
//   agents/<key>.json registry entry for agent <key>
//   notify/<key>      touched on every send to <key>
//   seen/<key>        read watermark of <key> (per-sender byte offsets)
//   live/<hostpid>    holds the key of the agent whose host process is <hostpid>
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

export const OWNER = "owner";
export const OWNER_WORDS = ["owner", "me", "user"];
export const TOOLS = ["claude", "codex", "agy"] as const;
export type Tool = (typeof TOOLS)[number];

export function root(): string {
  const env = process.env;
  if (env.OMSG_DIR) return env.OMSG_DIR;
  if (process.platform === "win32" && env.LOCALAPPDATA) {
    return join(env.LOCALAPPDATA, "omnikit", "mail");
  }
  const state = env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state");
  return join(state, "omnikit", "mail");
}

/** The file-safe key of a full name: every character outside [A-Za-z0-9._-] becomes `_`. */
export function keyOf(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_");
}

export const paths = {
  log: (key: string) => join(root(), `log-${key}.jsonl`),
  agents: () => join(root(), "agents"),
  agent: (key: string) => join(root(), "agents", `${key}.json`),
  notify: (key: string) => join(root(), "notify", key),
  seen: (key: string) => join(root(), "seen", key),
  liveDir: () => join(root(), "live"),
  live: (pid: number | string) => join(root(), "live", String(pid)),
};

export function ensureDirs(): void {
  for (const d of ["agents", "notify", "seen", "live"])
    mkdirSync(join(root(), d), { recursive: true });
}

/**
 * Mark new mail for `key`. The mtime is set from a microsecond clock rather than
 * left to the filesystem, whose coarse tick (several ms on Linux) would give two
 * quick touches the same mtime and hide the second one from the fast path.
 */
export function touchNotify(key: string): void {
  const p = paths.notify(key);
  writeFileSync(p, "");
  const t = (performance.timeOrigin + performance.now()) / 1000;
  utimesSync(p, t, t);
}

export function localHost(): string {
  return hostname();
}

export function fullName(tool: string, host: string, project: string, sid: string): string {
  return `${tool}@${host}/${project}#${sid.slice(0, 4)}`;
}

export type NameParts = { tool: Tool; host: string; project: string; sid4: string };

export function parseName(name: string): NameParts | null {
  const m = name.match(/^(claude|codex|agy)@([^/]+)\/(.+)#([^#/]+)$/);
  if (!m) return null;
  return { tool: m[1] as Tool, host: m[2], project: m[3], sid4: m[4] };
}

/** The name as printed: without `@<host>` when the host is this machine. */
export function display(name: string): string {
  const p = parseName(name);
  if (!p || p.host !== localHost()) return name;
  return `${p.tool}/${p.project}#${p.sid4}`;
}

/** The name with its host removed, whatever the host. */
export function hostless(name: string): string {
  const p = parseName(name);
  return p ? `${p.tool}/${p.project}#${p.sid4}` : name;
}
