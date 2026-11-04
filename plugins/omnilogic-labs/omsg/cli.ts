// omsg: mail between agent sessions (claude, codex, agy) and their owner.
// Run through the bin/omsg shim. Exit codes: 0 ok, 1 usage or error,
// 2 unknown or ambiguous address (candidates on stderr), 3 wait timed out.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AddressError, resolve, type Target } from "./address";
import { whoAmI, type Me } from "./identity";
import { display, OWNER, paths } from "./paths";
import { listAgents, prune, setAlias } from "./registry";
import {
  append,
  countUnread,
  findById,
  formatMail,
  makeRecord,
  takeUnread,
  TooLong,
  type Rec,
} from "./store";

export const USAGE = `usage: omsg [--as <address>] [--json] <command>
  send <to> <text|->     send a message (- reads stdin); <to> is a name, alias,
                         short form, @<project>, all, or owner
  reply <id> <text|->    reply to a message's sender, same thread
  read [--max N]         print unread mail and mark it read
  count                  number of unread messages (nothing at 0)
  wait [--timeout S]     block until mail arrives (exit 3 on timeout)
  who                    list agents
  tail                   follow new mail to me
  name <alias>           set my alias
  path                   print my storage paths as JSON
  hook <event> --host <claude|codex|agy>`;

/** Messages and characters `read` prints by default before it holds the rest back. */
export const READ_MAX = 20;
export const READ_BUDGET = 6000;

type Opts = { json: boolean; as?: string; max?: number; timeout?: number };
type Out = { out: (s: string) => void; err: (s: string) => void };

class Usage extends Error {}

// Where each command's free text starts: everything from there on is the body.
const BODY_AT: Record<string, number> = { send: 2, reply: 2 };

function parse(argv: string[]): { opts: Opts; pos: string[]; body: string[]; rest: string[] } {
  const opts: Opts = { json: false };
  const pos: string[] = [];
  const body: string[] = [];
  const rest: string[] = [];
  const num = (flag: string, v: string | undefined) => {
    const n = Number(v);
    if (v === undefined || !Number.isFinite(n) || n < 0) throw new Usage(`${flag} needs a number`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (pos[0] === "hook" && t !== "--json" && t !== "--as") {
      rest.push(t);
      continue;
    }
    const at = BODY_AT[pos[0]];
    if (at !== undefined && pos.length >= at) {
      body.push(t);
      continue;
    }
    if (t === "--json") opts.json = true;
    else if (t === "--as") {
      if (argv[i + 1] === undefined) throw new Usage("--as needs an address");
      opts.as = argv[++i];
    } else if (t.startsWith("--as=")) opts.as = t.slice(5);
    else if (t === "--max") opts.max = Math.floor(num("--max", argv[++i]));
    else if (t === "--timeout") opts.timeout = num("--timeout", argv[++i]);
    else if (t === "-h" || t === "--help") pos.unshift("help");
    else if (t.startsWith("--") && t.length > 2) throw new Usage(`unknown flag ${t}`);
    else pos.push(t);
  }
  return { opts, pos, body, rest };
}

async function bodyOf(words: string[]): Promise<string> {
  const text = words.length === 1 && words[0] === "-" ? await Bun.stdin.text() : words.join(" ");
  const body = text.replace(/\r?\n$/, "");
  if (!body.trim()) throw new Usage("nothing to send");
  return body;
}

function sendTo(me: Me, targets: Target[], body: string, thread?: string): Rec[] {
  const recs = targets.map((t) => makeRecord(me.name, t.name, body, thread));
  append(recs);
  return recs;
}

function reportSent(o: Out, opts: Opts, recs: Rec[], targets: Target[], label: string) {
  if (opts.json) return o.out(JSON.stringify(recs));
  if (targets.length === 1) {
    const t = targets[0];
    const who = display(t.name);
    o.out(
      t.live ? `sent [${recs[0].id}] to ${who}` : `queued [${recs[0].id}] for ${who} (offline)`
    );
    return;
  }
  o.out(`sent to ${label} (${targets.length}): ${targets.map((t) => display(t.name)).join(", ")}`);
}

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};

async function run(argv: string[], o: Out): Promise<number> {
  const { opts, pos, body, rest } = parse(argv);
  const cmd = pos[0];
  if (!cmd || cmd === "help") {
    (cmd ? o.out : o.err)(USAGE);
    return cmd ? 0 : 1;
  }
  const arity: Record<string, number> = {
    send: 2,
    reply: 2,
    read: 1,
    count: 1,
    wait: 1,
    who: 1,
    tail: 1,
    name: 2,
    path: 1,
  };

  if (cmd === "hook") {
    // Hook dispatch. The omsg-hooks task adds ./hook.ts exporting
    //   hook(args: string[], opts: { json: boolean; as?: string }): Promise<number>
    const hookPath = join(import.meta.dir, "hook.ts");
    if (!existsSync(hookPath)) {
      o.err("omsg: hook support is not installed");
      return 1;
    }
    const mod = await import(hookPath);
    return await mod.hook(rest, { json: opts.json, as: opts.as });
  }
  if (!(cmd in arity)) throw new Usage(`unknown command ${cmd}`);
  if (pos.length !== arity[cmd]) throw new Usage(`${cmd}: wrong number of arguments`);

  if (cmd === "send" || cmd === "reply") {
    if (body.length === 0) throw new Usage(`${cmd} needs text, or - to read stdin`);
    const entries = prune();
    const me = whoAmI(opts.as, entries);
    const text = await bodyOf(body);
    if (cmd === "send") {
      const r = resolve(pos[1], entries, me.name);
      const recs = sendTo(me, r.targets, text);
      reportSent(o, opts, recs, r.targets, r.label);
      return 0;
    }
    const found = findById(pos[1]);
    const orig = found.find((r) => me.names.includes(r.to)) || found[0];
    if (!orig) throw new Error(`no message with id ${pos[1]}`);
    const entry = entries.find((e) => e.name === orig.from);
    const target: Target = {
      name: orig.from,
      live: orig.from === OWNER || !!entry?.live,
      entry,
    };
    const recs = sendTo(me, [target], text, orig.thread || orig.id);
    reportSent(o, opts, recs, [target], display(orig.from));
    return 0;
  }

  const me = whoAmI(opts.as);

  if (cmd === "count") {
    const n = countUnread(me.key, me.names);
    if (opts.json) o.out(JSON.stringify({ count: n }));
    else if (n > 0) o.out(String(n));
    return 0;
  }
  if (cmd === "read") {
    const max = opts.max ?? READ_MAX;
    const { recs, more } = takeUnread(me.key, me.names, {
      max,
      budget: opts.max === undefined ? READ_BUDGET : Infinity,
    });
    if (opts.json) o.out(JSON.stringify(recs));
    else if (recs.length || more) o.out(formatMail(recs, more));
    return 0;
  }
  if (cmd === "wait") {
    const deadline = opts.timeout === undefined ? Infinity : Date.now() + opts.timeout * 1000;
    for (;;) {
      if (countUnread(me.key, me.names) > 0) return 0;
      if (Date.now() >= deadline) return 3;
      await Bun.sleep(Math.min(250, Math.max(10, deadline - Date.now())));
    }
  }
  if (cmd === "tail") {
    for (;;) {
      const { recs } = takeUnread(me.key, me.names);
      if (recs.length) {
        o.out(opts.json ? recs.map((r) => JSON.stringify(r)).join("\n") : formatMail(recs));
      }
      await Bun.sleep(500);
    }
  }
  if (cmd === "who") {
    const entries = prune();
    if (opts.json) {
      o.out(JSON.stringify(entries.map(({ key, ...e }) => ({ ...e, self: e.name === me.name }))));
      return 0;
    }
    for (const e of entries) {
      const mark = e.name === me.name ? "*" : " ";
      const state = e.live ? "live" : "offline";
      o.out(
        [
          `${mark} ${display(e.name)}`,
          e.alias || "-",
          state,
          `seen ${ago(e.lastSeen)}`,
          e.cwd,
        ].join("  ")
      );
    }
    return 0;
  }
  if (cmd === "name") {
    if (!me.agent) throw new Error("only a registered agent session can take an alias");
    const a = setAlias(me.agent, pos[1]);
    o.out(opts.json ? JSON.stringify(a) : `${display(a.name)} is now ${a.alias}`);
    return 0;
  }
  if (cmd === "path") {
    o.out(
      JSON.stringify({
        name: me.name,
        notify: paths.notify(me.key),
        seen: paths.seen(me.key),
        ownerNotify: paths.notify(OWNER),
        ownerSeen: paths.seen(OWNER),
      })
    );
    return 0;
  }
  return 1;
}

export async function main(
  argv: string[],
  o: Out = {
    out: (s) => process.stdout.write(s + "\n"),
    err: (s) => process.stderr.write(s + "\n"),
  }
): Promise<number> {
  try {
    return await run(argv, o);
  } catch (e) {
    if (e instanceof AddressError) {
      o.err(`omsg: ${e.message}`);
      for (const c of e.candidates) o.err(`  ${c}`);
      return 2;
    }
    if (e instanceof Usage) {
      o.err(`omsg: ${e.message}\n${USAGE}`);
      return 1;
    }
    o.err(`omsg: ${e instanceof TooLong ? e.message : (e as Error).message || String(e)}`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
