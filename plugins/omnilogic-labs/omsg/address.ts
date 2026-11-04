// Address resolution. In order: groups (owner, all, @<project>), exact full name
// (with or without @<host>), alias, then short forms (`codex/omnikit`, `#3f9a`,
// `omnikit`) that must match exactly one live or queued agent.
import { display, hostless, OWNER, OWNER_WORDS, parseName } from "./paths";
import type { Entry } from "./registry";

export class AddressError extends Error {
  constructor(
    message: string,
    public candidates: string[] = []
  ) {
    super(message);
  }
}

export type Target = { name: string; live: boolean; entry?: Entry };
export type Resolved = { kind: "owner" | "agent" | "group"; label: string; targets: Target[] };

const asTarget = (e: Entry): Target => ({ name: e.name, live: e.live, entry: e });

/** Live agents, plus dead ones that hold an alias (mail to them queues). */
const reachable = (entries: Entry[]) => entries.filter((e) => e.live || !!e.alias);

function one(addr: string, hits: Entry[]): Resolved | null {
  const uniq = [...new Map(hits.map((h) => [h.name, h])).values()];
  if (uniq.length === 0) return null;
  if (uniq.length > 1) {
    throw new AddressError(
      `"${addr}" matches ${uniq.length} agents; use a longer form`,
      uniq.map(
        (e) => display(e.name) + (e.alias ? ` (${e.alias})` : "") + (e.live ? "" : " offline")
      )
    );
  }
  return { kind: "agent", label: display(uniq[0].name), targets: [asTarget(uniq[0])] };
}

export function resolve(addr: string, entries: Entry[], self?: string): Resolved {
  const a = addr.trim();
  if (!a) throw new AddressError("empty address");
  if (OWNER_WORDS.includes(a)) {
    return { kind: "owner", label: OWNER, targets: [{ name: OWNER, live: true }] };
  }
  if (a === "all" || a.startsWith("@")) {
    const project = a === "all" ? null : a.slice(1);
    const members = entries.filter(
      (e) => e.live && e.name !== self && (project === null || e.project === project)
    );
    if (members.length === 0) throw new AddressError(`no live agents in ${a}`);
    return { kind: "group", label: a, targets: members.map(asTarget) };
  }

  // Exact full name: any registered entry, live or not; a well-formed name that
  // is not registered still resolves (its mail waits until that agent reads).
  const exact = entries.find((e) => e.name === a);
  if (exact) return { kind: "agent", label: display(a), targets: [asTarget(exact)] };
  if (parseName(a))
    return { kind: "agent", label: display(a), targets: [{ name: a, live: false }] };
  const hl = one(
    a,
    entries.filter((e) => hostless(e.name) === a)
  );
  if (hl) return hl;

  const pool = reachable(entries);
  const byAlias = pool.filter((e) => e.alias === a);
  const live = byAlias.filter((e) => e.live);
  const alias = one(a, live.length ? live : byAlias);
  if (alias) return alias;

  let hits: Entry[];
  if (a.startsWith("#")) {
    const sid = a.slice(1);
    hits = sid ? pool.filter((e) => parseName(e.name)?.sid4.startsWith(sid)) : [];
  } else if (a.includes("/")) {
    const [tool, rest] = [a.slice(0, a.indexOf("/")), a.slice(a.indexOf("/") + 1)];
    const [project, sid] = rest.includes("#") ? rest.split("#") : [rest, ""];
    hits = pool.filter((e) => {
      const p = parseName(e.name);
      return p && p.tool === tool && p.project === project && p.sid4.startsWith(sid);
    });
  } else {
    hits = pool.filter((e) => e.project === a || e.tool === a);
  }
  const short = one(a, hits);
  if (short) return short;
  throw new AddressError(
    `unknown address "${a}"`,
    pool.map((e) => display(e.name) + (e.alias ? ` (${e.alias})` : ""))
  );
}
