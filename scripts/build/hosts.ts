// The one table of per-host facts: model names, efforts, tool names, output locations.
// Templates read these through {{...}} vars; nothing else in the repo should name a model.

export type HostName = "claude" | "codex" | "agy";
export type Tier = "deep" | "fast";

/** What an agent may do. Each host maps these to its own tool names. */
export const CAPABILITIES = ["read", "edit", "shell", "web"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export interface Host {
  name: HostName;
  /** Display name for prose. */
  label: string;
  /** Model a subagent file or Agent call names, per tier. */
  tier: Record<Tier, string>;
  /** Models an agent file may name on this host. Unset means any name. */
  allowedModels?: string[];
  /** Reasoning effort per tier, where the host has one. */
  effort?: Record<Tier, string>;
  /** Model the host's CLI (and the external_worker tool) takes, per tier. */
  cli: Record<Tier, string>;
  /** Dispatch tool names, read as {{tool.<key>}}. */
  tool: Record<string, string>;
  /**
   * Agent tool allowlist per capability. An agent source lists capabilities (`capabilities:`) and
   * this host's agent file gets `tools:` with every name they map to, plus `baseTools`. Unset means
   * the host's agent files carry no tool list.
   */
  toolsets?: Record<Capability, string[]>;
  /** Tools every agent file on this host gets, whatever its capabilities. */
  baseTools?: string[];
  /** Model and effort for a one-shot external review through the host's CLI, read as {{review.*}}. */
  review?: { model: string; effort?: string };
  /** Model for a subagent whose only job is to run one CLI command, read as {{runner.model}}. */
  runner?: string;
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
    review: { model: "gpt-6.1-sol", effort: "xhigh" },
    alt: { frontier: "gpt-6-astra" },
    tool: { agent: "spawn_agent" },
    root: "dist/codex",
    agentFormat: "codex-toml",
    skillFrontmatterKeys: null,
  },
  agy: {
    name: "agy",
    label: "Antigravity (agy)",
    // The agent file tiers pro and flash are unnamed Gemini models, so agents inherit the
    // parent's model and the owner's choice of main model decides.
    tier: { deep: "inherit", fast: "inherit" },
    allowedModels: ["pro", "flash", "inherit"],
    // CLI slugs pin the effort level, so never pass --effort with them.
    cli: { deep: "gemini-4-argon-high", fast: "gemini-3.8-flash-medium" },
    review: { model: "gemini-4-argon-high" },
    tool: { agent: "invoke_subagent", message: "send_message", selfType: "self" },
    runner: "flash_lite",
    // agy's internal tool names, checked 2026-10-23 with agy 1.4.6 by running a subagent with each
    // list. An unknown name fails the whole agent ("tool not found in registry"). Not in the
    // registry: codebase_search, command_status, send_command_input, read_terminal,
    // view_content_chunk, browser_subagent.
    toolsets: {
      read: ["view_file", "list_dir", "grep_search", "find_by_name"],
      edit: ["write_to_file", "replace_file_content"],
      shell: ["run_command"],
      web: ["search_web", "read_url_content"],
    },
    baseTools: ["send_message", "manage_task", "schedule"],
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
  if (h.runner) v["runner.model"] = h.runner;
  if (h.review) {
    v["review.model"] = h.review.model;
    if (h.review.effort) v["review.effort"] = h.review.effort;
  }
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
