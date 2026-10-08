// The OS table, a sibling of hosts.ts: the operating systems a template can branch on.
// Windows means Git Bash. Templates read these through {{os.*}} vars and @if blocks.

export type OsName = "linux" | "wsl" | "macos" | "windows";
/** The OS a tree is rendered for. "any" keeps every OS block, each under its label line. */
export type OsTarget = OsName | "any";

export interface Os {
  name: OsName;
  /** Name used in labels, as in "On Linux and WSL:". */
  label: string;
  /** Read as {{os.<key>}}; add keys here to extend. */
  vars: Record<string, string>;
}

export const OSES: Record<OsName, Os> = {
  linux: {
    name: "linux",
    label: "Linux",
    vars: { name: "Linux", shell: "bash", home: "~", tmp: "/tmp" },
  },
  wsl: {
    name: "wsl",
    label: "WSL",
    vars: { name: "WSL", shell: "bash", home: "~", tmp: "/tmp" },
  },
  macos: {
    name: "macos",
    label: "macOS",
    vars: { name: "macOS", shell: "zsh", home: "~", tmp: "$TMPDIR" },
  },
  windows: {
    name: "windows",
    label: "Windows (Git Bash)",
    vars: { name: "Windows", shell: "Git Bash", home: "~", tmp: "$TEMP" },
  },
};

export const OS_NAMES = Object.keys(OSES) as OsName[];
export const OS_TARGETS: OsTarget[] = [...OS_NAMES, "any"];

export function isOsTarget(s: string): s is OsTarget {
  return (OS_TARGETS as string[]).includes(s);
}

/** {{os.*}} vars for one OS. */
export function osVars(os: OsName): Record<string, string> {
  const v: Record<string, string> = {};
  for (const [k, val] of Object.entries(OSES[os].vars)) v[`os.${k}`] = val;
  return v;
}

/** The any-OS label line for a block: "On Windows (Git Bash):", "On Linux and WSL:". */
export function osLabel(list: readonly OsName[]): string {
  const names = list.map((o) => OSES[o].label);
  const joined =
    names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `On ${joined}:`;
}

/**
 * The OS this machine is, mirroring install.sh detect_os. Inputs are injectable so tests do not
 * depend on the host: platform is process.platform or a `uname -s` string, procVersion the text
 * of /proc/version (null when unreadable).
 */
export function detectOs(platform: string, procVersion: string | null): OsName {
  if (platform === "darwin" || platform === "Darwin") return "macos";
  if (platform === "win32" || /^(MINGW|MSYS|CYGWIN)/i.test(platform)) return "windows";
  if (procVersion && /microsoft/i.test(procVersion)) return "wsl";
  return "linux";
}

/** Where the default dist OS came from, as printed in the build status line. */
export type OsSource = "--os" | "OMNIKIT_OS" | "recorded in dist/*/.os" | "detected";

/**
 * The dist OS when --os is not given: OMNIKIT_OS (validated like install.sh: a concrete OS),
 * then a concrete OS recorded in every dist/<host>/.os when they agree, then detection.
 * Throws when OMNIKIT_OS is set to anything but a concrete OS.
 */
export function defaultOs(
  env: string | undefined,
  recorded: (string | null)[],
  detect: () => OsName
): { os: OsName; source: OsSource } {
  if (env) {
    if (!(OS_NAMES as string[]).includes(env)) {
      throw new Error(`OMNIKIT_OS must be ${OS_NAMES.join(", ")} (got ${env})`);
    }
    return { os: env as OsName, source: "OMNIKIT_OS" };
  }
  const vals = recorded.map((r) => r?.trim() ?? "");
  const first = vals[0];
  if (vals.length > 0 && (OS_NAMES as string[]).includes(first) && vals.every((v) => v === first)) {
    return { os: first as OsName, source: "recorded in dist/*/.os" };
  }
  return { os: detect(), source: "detected" };
}
