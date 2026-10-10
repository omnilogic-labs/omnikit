// The owner inbox: one artifact page whose `db` holds an "items" collection,
// one document per thing a session needs from the owner. Every session writes
// its own items through the inbox tool below, which calls ArtifactData; the
// page writes only the owner's fields (ownerStatus, ownerReply, ownerAt).
export const TOOL_NAME = "inbox";
export const COLLECTION = "items";
export const STATES = ["do", "next", "running", "decided"] as const;
export const KINDS = ["form", "chore", "request", "update"] as const;
// Store keys, shared by every session through the plugin's own store.
export const URL_KEY = "inbox.url";
export const LABELS_KEY = "inbox.labels"; // session id -> the name this session posts under
export const SEEN_KEY = "inbox.seen"; // item id -> the ownerAt this session last told the model about
export const INBOX_POLL_MS = 5 * 60_000;
// A session deletes its own decided items this long after they settle, so the
// 25,000 document cap is never reached.
export const PRUNE_MS = 30 * 24 * 3600_000;
export const ARTIFACT_URL = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/;

export type Item = {
  id: string;
  version: number;
  data: Record<string, unknown>;
};

export type InboxInput = {
  action?: unknown;
  url?: unknown;
  id?: unknown;
  title?: unknown;
  body?: unknown;
  links?: unknown;
  kind?: unknown;
  state?: unknown;
  note?: unknown;
  session?: unknown;
  reopen?: unknown;
  all?: unknown;
};

export const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
export const field = (it: Item, k: string) => str(it.data[k]);

// The documents an ArtifactData read returns: one JSON object per line between
// its BEGIN and END markers.
export function parseDocs(text: string): Item[] {
  const items: Item[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const d = JSON.parse(line) as { id?: unknown; version?: unknown; data?: unknown };
      if (typeof d.id === "string" && d.data !== null && typeof d.data === "object") {
        items.push({
          id: d.id,
          version: Number(d.version) || 0,
          data: d.data as Record<string, unknown>,
        });
      }
    } catch {
      // not a document line
    }
  }
  return items;
}

export function parseLinks(v: unknown): { label: string; url: string }[] | string {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return "links must be a list of { label, url }";
  const out: { label: string; url: string }[] = [];
  for (const l of v) {
    const url = str((l as { url?: unknown } | null)?.url);
    if (!/^https:\/\//.test(url)) return `each link needs an https url (got ${JSON.stringify(l)})`;
    out.push({ label: str((l as { label?: unknown }).label) || "Open", url });
  }
  return out;
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

export function describe(it: Item, mine: boolean): string {
  const owner = field(it, "ownerStatus");
  const reply = field(it, "ownerReply");
  return (
    `- ${it.id} [${field(it, "state") || "do"}, ${field(it, "kind") || "update"}] ${field(it, "title")}` +
    (mine ? "" : ` (from ${field(it, "session")} in ${field(it, "project")})`) +
    (owner ? `; owner marked it ${owner}` : "") +
    (reply ? `; owner replied: ${JSON.stringify(reply)}` : "")
  );
}
