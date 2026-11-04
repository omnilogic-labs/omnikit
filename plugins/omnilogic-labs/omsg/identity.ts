// Who is running omsg: --as wins; else the nearest ancestor process registered
// in live/<hostpid> (a claude, codex or agy session); else an OMSG_NAME alias
// held by a live agent; else the owner.
import { readdirSync } from "node:fs";
import { resolve, AddressError } from "./address";
import { keyOf, OWNER, paths } from "./paths";
import { ancestors } from "./proc";
import { listAgents, liveKeyFor, readAgent, type Agent, type Entry } from "./registry";

export type Me = {
  name: string;
  key: string;
  /** Every name whose mail this reader receives: its own plus any it inherited. */
  names: string[];
  agent?: Agent;
};

export const owner = (): Me => ({ name: OWNER, key: OWNER, names: [OWNER] });

function fromAgent(a: Agent): Me {
  return { name: a.name, key: keyOf(a.name), names: [a.name, ...(a.inherits || [])], agent: a };
}

function byAncestor(): Me | null {
  try {
    if (readdirSync(paths.liveDir()).length === 0) return null;
  } catch {
    return null;
  }
  for (const p of ancestors()) {
    const key = liveKeyFor(p.pid);
    if (!key) continue;
    const a = readAgent(key);
    if (a && a.pid === p.pid && (!a.pidStart || a.pidStart === p.start)) return fromAgent(a);
  }
  return null;
}

export function whoAmI(as?: string, entries?: Entry[]): Me {
  if (as !== undefined) {
    const r = resolve(as, entries || listAgents());
    if (r.kind === "owner") return owner();
    if (r.kind === "group") throw new AddressError(`--as needs one agent, not the group ${as}`);
    const t = r.targets[0];
    if (t.entry) return fromAgent(t.entry);
    return { name: t.name, key: keyOf(t.name), names: [t.name] };
  }
  const anc = byAncestor();
  if (anc) return anc;
  const alias = process.env.OMSG_NAME;
  if (alias) {
    const hit = (entries || listAgents()).find((e) => e.alias === alias && e.live);
    if (hit) return fromAgent(hit);
  }
  return owner();
}
