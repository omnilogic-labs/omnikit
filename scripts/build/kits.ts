// The one table of kits: smaller Claude Code plugins built from the same src/ as the whole
// omnilogic-labs plugin. A kit names the skills and agents it carries and the plugin bin files it
// copies. Each kit's plugin lives at plugins/<plugin>/, beside plugins/omnilogic-labs/, and holds
// only generated skills/, agents/ and bin/ plus its hand-written .claude-plugin/plugin.json.
//
// Templates tell kits apart with `<!-- @if kit:<name> -->`; the whole plugin, the root skills/
// tree and dist/ render as the kit "full" (FULL_KIT in render.ts).

import { FULL_KIT } from "./render";

export interface Kit {
  /** Short name, as `install.sh --kit <name>` and `@if kit:<name>` take it. */
  name: string;
  /** Claude Code plugin name; the plugin tree is plugins/<plugin>. */
  plugin: string;
  /** Skill folders under src/skills. */
  skills: string[];
  /** Agent files under src/agents, without .md. */
  agents: string[];
  /** Files copied from the whole plugin's bin/ (plugins/omnilogic-labs/bin). */
  bin: string[];
}

export const KITS: Kit[] = [
  {
    // For people who are not developers: how the agent writes, images, and a browser. No
    // coordinator (it assumes git worktrees and a developer at the keyboard) and no external runner.
    name: "essentials",
    plugin: "omnilogic-labs-essentials",
    skills: ["agent-browser", "artistic-vision", "plain-writing"],
    agents: ["browser-buddy"],
    bin: ["agent-browser"],
  },
];

/** Every kit name an @if may use: "full" and each kit's. */
export function kitNames(kits: readonly Kit[] = KITS): string[] {
  return [FULL_KIT, ...kits.map((k) => k.name)];
}

export function kitRoot(kit: Kit): string {
  return `plugins/${kit.plugin}`;
}
