// `omsg hook <event> --host <claude|codex|agy>`: the host hooks that register a
// session and hand it its mail. Codex and agy pipe their hook JSON on stdin and
// read what we print; the Claude mod passes --sid and --cwd and reads the paths.
//
//   start           register (agents/<key>.json, live/<hostpid>; OMSG_NAME is the
//                   alias) and inject the mail rule plus any queued mail
//   post-tool       codex PostToolUse: inject new mail; agy PostToolUse: print {}
//   pre-invocation  agy PreInvocation: inject new mail
//   stop            with unread mail, keep the turn going with it
//   end             unregister
//
// The common no-mail post-tool and pre-invocation answer comes from bin/omsg in
// bash before Bun starts; this file runs when that fast path says "maybe mail".
// A hook never breaks its host: failures go to stderr and exit 0.
import { display, keyOf, OWNER, paths, TOOLS, type Tool } from "./paths";
import { ancestors } from "./proc";
import {
  listAgents,
  liveKeyFor,
  readAgent,
  register,
  removeAgent,
  touchSeen,
  type Agent,
} from "./registry";
import { formatMail, takeUnread } from "./store";

export const MAIL_RULE =
  "Mail from other agents and the owner arrives in your context automatically as " +
  "`omsg from <sender> [<id>]: <body>` lines; never poll for it.\n" +
  "Reply with `omsg reply <id> <text>`; send with `omsg send <to> <text>` " +
  "(to: `owner`, a name from `omsg who`, `@<project>`, `all`).";

/** Most messages one injection carries, and the body characters it packs before holding the rest back. */
export const HOOK_MAX = 5;
export const HOOK_BUDGET = 2000;

const EVENTS = ["start", "post-tool", "pre-invocation", "stop", "end"] as const;
type Event = (typeof EVENTS)[number];

type Args = { event: Event; host: Tool; sid?: string; cwd?: string; pid?: number };
type Input = Record<string, unknown>;

const SHELLS = ["sh", "bash", "dash", "zsh", "ash", "busybox"];

function parseArgs(argv: string[]): Args | string {
  const [event, ...rest] = argv;
  if (!(EVENTS as readonly string[]).includes(event)) return `unknown hook event ${event ?? ""}`;
  const out: Partial<Args> = { event: event as Event };
  for (let i = 0; i < rest.length; i++) {
    const [flag, v] = [rest[i], rest[i + 1]];
    if (v === undefined) return `${flag} needs a value`;
    if (flag === "--host") out.host = v as Tool;
    else if (flag === "--sid") out.sid = v;
    else if (flag === "--cwd") out.cwd = v;
    else if (flag === "--pid") out.pid = Number(v);
    else return `unknown hook flag ${flag}`;
    i++;
  }
  if (!out.host || !(TOOLS as readonly string[]).includes(out.host)) {
    return "hook needs --host claude, codex or agy";
  }
  if (out.pid !== undefined && !(Number.isInteger(out.pid) && out.pid > 0)) {
    return "--pid needs a process id";
  }
  return out as Args;
}

async function readInput(host: Tool): Promise<Input> {
  // The Claude mod passes flags and leaves stdin alone; never wait on it.
  if (host === "claude") return {};
  try {
    const j = JSON.parse(await Bun.stdin.text());
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

function sidOf(a: Args, j: Input): string | undefined {
  return a.sid || str(j.session_id) || str(j.conversationId);
}

function cwdOf(a: Args, j: Input): string {
  const ws = Array.isArray(j.workspacePaths) ? str(j.workspacePaths[0]) : undefined;
  return a.cwd || str(j.cwd) || ws || process.cwd();
}

/**
 * The host process: --pid, else the nearest ancestor running as the host tool,
 * else codex's direct parent or, for agy (which runs hooks via `sh -c`), the
 * parent of that shell. bin/omsg's fast path checks the same two pids.
 */
export function hostPid(host: Tool, pid?: number): number {
  if (pid) return pid;
  const anc = ancestors();
  const hit = anc.find((p) => p.names.includes(host));
  if (hit) return hit.pid;
  const parent = anc[0];
  if (!parent) return process.ppid;
  const shell = parent.names.some((n) => SHELLS.includes(n));
  if (host === "agy" && shell && anc[1]) return anc[1].pid;
  return parent.pid;
}

/** The registered agent for this hook call: by --sid when given, else by live/<hostpid>. */
function findAgent(a: Args, sid: string | undefined, pid: number): Agent | null {
  const key = liveKeyFor(pid);
  const byPid = key ? readAgent(key) : null;
  if (byPid && byPid.tool === a.host && (!sid || byPid.sid === sid)) return byPid;
  if (!sid) return null;
  return listAgents().find((e) => e.tool === a.host && e.sid === sid) || null;
}

/** Take up to the cap of unread mail and format it, or "" when there is none. */
export function deliver(agent: Agent): string {
  const names = [agent.name, ...(agent.inherits || [])];
  const { recs, more } = takeUnread(keyOf(agent.name), names, {
    max: HOOK_MAX,
    budget: HOOK_BUDGET,
  });
  return recs.length || more ? formatMail(recs, more) : "";
}

const inject = (host: Tool, event: string, text: string): string =>
  host === "agy"
    ? JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: text } }] })
    : JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });

async function run(a: Args, out: (s: string) => void): Promise<number> {
  // agy's PostToolUse cannot inject and must answer {}.
  if (a.event === "post-tool" && a.host === "agy") {
    out("{}");
    return 0;
  }
  const j = await readInput(a.host);
  const sid = sidOf(a, j);
  const pid = hostPid(a.host, a.pid);

  if (a.event === "start") {
    if (!sid) throw new Error("hook start needs a session id (--sid, or session_id on stdin)");
    const agent = register({
      tool: a.host,
      sid,
      pid,
      cwd: cwdOf(a, j),
      alias: process.env.OMSG_NAME || undefined,
    });
    const key = keyOf(agent.name);
    if (a.host === "claude") {
      // The mod tells the rule and reads mail itself; it needs the paths to watch.
      out(
        JSON.stringify({
          name: agent.name,
          notify: paths.notify(key),
          seen: paths.seen(key),
          ownerNotify: paths.notify(OWNER),
          ownerSeen: paths.seen(OWNER),
        })
      );
      return 0;
    }
    const mail = deliver(agent);
    const intro = `You are ${display(agent.name)}${agent.alias ? ` (alias ${agent.alias})` : ""} on omsg.`;
    out(inject(a.host, "SessionStart", [intro, MAIL_RULE, mail].filter(Boolean).join("\n")));
    return 0;
  }

  let agent = findAgent(a, sid, pid);
  if (a.event === "end") {
    if (agent) removeAgent(agent);
    return 0;
  }
  if (a.host === "claude") return 0; // the mod delivers Claude's mail
  let rule = "";
  if (!agent) {
    // The start hook did not run (wired later, or resumed): register now and
    // tell the rule with the first delivery.
    if (!sid) return 0;
    agent = register({
      tool: a.host,
      sid,
      pid,
      cwd: cwdOf(a, j),
      alias: process.env.OMSG_NAME || undefined,
    });
    rule = MAIL_RULE;
  } else touchSeen(agent);
  const mail = deliver(agent);
  const text = [rule, mail].filter(Boolean).join("\n");

  if (a.event === "stop") {
    // Only mail keeps a turn going; the rule alone waits for the next start.
    if (!mail) return 0;
    out(JSON.stringify({ decision: a.host === "agy" ? "continue" : "block", reason: text }));
    return 0;
  }
  if (!text) return 0;
  out(inject(a.host, a.host === "agy" ? "PreInvocation" : "PostToolUse", text));
  return 0;
}

export async function hook(
  argv: string[],
  _opts: { json: boolean; as?: string },
  out: (s: string) => void = (s) => process.stdout.write(s + "\n")
): Promise<number> {
  const a = parseArgs(argv);
  if (typeof a === "string") {
    process.stderr.write(
      `omsg: ${a}\nusage: omsg hook <${EVENTS.join("|")}> --host <claude|codex|agy> [--sid S] [--cwd D] [--pid P]\n`
    );
    return 1;
  }
  try {
    return await run(a, out);
  } catch (e) {
    process.stderr.write(`omsg hook ${a.event}: ${(e as Error).message || String(e)}\n`);
    return 0;
  }
}
