# Codex roster

Read this when the active Codex harness exposes agent delegation. It makes the Claude agent
contracts usable without treating Claude frontmatter as Codex configuration.

## Resolve a role

1. Read `../../../roles.yaml` and find the role's `tier` and `reasoning`.
2. Resolve that tier through `tiers.<tier>.codex`.
3. Spawn the child with that Codex `model` and `reasoning_effort`.
4. Put the role contract in the child brief: read
   `../../../agents/<role>.md`, follow its body, and treat its Claude-only frontmatter
   (`model`, `effort`, and tool names) as documentation rather than configuration.

The role names and files are `orchestrator`, `delegate`, `planned-delegate`, `planner`,
`plan-author`, `researcher`, `scout`, `verifier`, `fixer`, and `integrator`. The browser
operator's contract is `../../../../browser-buddy/agents/browser-buddy.md` relative to the
Omnikit plugin root, with tier 3 from `roles.yaml`.

Pass the agent only the role's actual inputs. The worktree-pipeline dispatch contract still
applies, including its worktree path, environment facts, scope boundary, and return shape.

## Codex model allocation

| Tier | Model | Reasoning |
| ---- | ----- | --------- |
| 1 | `gpt-6-astra` | medium |
| 2 | `gpt-5.6-sol` | high |
| 3 | `gpt-5.6-terra` | medium |
| 4 | `gpt-5.6-luna` | medium, explicit override only |

Use the actual model and reasoning from the spawn result in the dispatch log. If a model or
reasoning level is unavailable in the active Codex host, choose the nearest higher tier and
record that choice. Do not silently lower a role.
