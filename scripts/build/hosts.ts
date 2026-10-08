// The one table of per-host facts: model names, efforts, tool names, output locations.
// Templates read these through {{...}} vars; nothing else in the repo should name a model.

export type HostName = "claude" | "codex" | "agy";
export type Tier = "deep" | "fast";

export interface Host {
  name: HostName;
  /** Display name for prose. */
  label: string;
  /** Model a subagent file or Agent call names, per tier. */
  tier: Record<Tier, string>;
  /** Reasoning effort per tier, where the host has one. */
  effort?: Record<Tier, string>;
  /** Model the host's CLI (and the external_worker tool) takes, per tier. */
  cli: Record<Tier, string>;
  /** Dispatch tool names, read as {{tool.<key>}}. */
  tool: Record<string, string>;
  /** Other models the host has but we do not use by default, read as {{alt.<key>}}. */
  alt?: Record<string, string>;
  /** Output root for this host's skills/ and agents/, relative to the build out dir. */
  root: string;
  /** Agent file format this host gets. */
  agentFormat: "claude-md" | "codex-toml" | "agy-md";
  /**
   * Top-level SKILL.md frontmatter keys this host keeps. null keeps every key.
   * host-facts may tighten this when a host rejects unknown keys.
   */
  skillFrontmatterKeys: string[] | null;
}

export const HOSTS: Record<HostName, Host> = {
  claude: {
    name: "claude",
    label: "Claude Code",
    tier: { deep: "opus", fast: "sonnet" },
    cli: { deep: "opus", fast: "sonnet" },
    alt: { stronger: "fable", lighter: "haiku" },
    tool: {
      agent: "Agent",
      agentType: "subagent_type",
      message: "SendMessage",
      external: "mcp__omnilogic-labs__external_worker",
    },
    root: "plugins/omnilogic-labs",
    agentFormat: "claude-md",
    skillFrontmatterKeys: null,
  },
  codex: {
    name: "codex",
    label: "Codex",
    tier: { deep: "gpt-6.1-sol", fast: "gpt-6-luna" },
    effort: { deep: "high", fast: "medium" },
    cli: { deep: "gpt-6.1-sol", fast: "gpt-6-luna" },
    alt: { frontier: "gpt-6-astra" },
    tool: { agent: "spawn_agent" },
    root: "dist/codex",
    agentFormat: "codex-toml",
    skillFrontmatterKeys: null,
  },
  agy: {
    name: "agy",
    label: "Antigravity (agy)",
    tier: { deep: "pro", fast: "flash" },
    cli: { deep: "gemini-3.1-pro-high", fast: "gemini-3.8-flash-medium" },
    tool: { agent: "invoke_subagent" },
    root: "dist/agy",
    agentFormat: "agy-md",
    skillFrontmatterKeys: null,
  },
};

export const HOST_NAMES = Object.keys(HOSTS) as HostName[];

/** Path from a skill folder (<root>/skills/<name>/) to the role files (<root>/agents/). */
export const AGENTS_DIR = "../../agents";

/** Vars one host's own templates see, without cross-host prefixes. */
function ownVars(h: Host): Record<string, string> {
  const v: Record<string, string> = {
    "host.name": h.name,
    "host.label": h.label,
    "agents.dir": AGENTS_DIR,
  };
  for (const t of ["deep", "fast"] as Tier[]) {
    v[`tier.${t}`] = h.tier[t];
    v[`cli.${t}`] = h.cli[t];
    if (h.effort) v[`effort.${t}`] = h.effort[t];
  }
  for (const [k, name] of Object.entries(h.tool)) v[`tool.${k}`] = name;
  for (const [k, name] of Object.entries(h.alt ?? {})) v[`alt.${k}`] = name;
  return v;
}

/** Every var a template rendered for `host` may use: its own, plus `<host>.<var>` for every host. */
export function varsFor(
  host: HostName,
  hosts: Record<HostName, Host> = HOSTS
): Record<string, string> {
  const vars = ownVars(hosts[host]);
  for (const h of Object.values(hosts)) {
    for (const [k, val] of Object.entries(ownVars(h))) {
      if (k === "agents.dir") continue;
      vars[`${h.name}.${k}`] = val;
    }
  }
  return vars;
}
