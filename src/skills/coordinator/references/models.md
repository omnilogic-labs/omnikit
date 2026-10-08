# Model tiers

The coordinator names two tiers, never a model. This file is the only place a tier becomes a model name. Edit
it when a host ships new models.

- **deep:** the model we trust with planning, hard builds and milestone reviews. It is our usual choice for
  careful work, not necessarily the most capable model the host offers.
- **fast:** the model for rote building and per-task verification. It is cheaper and quicker, not necessarily
  the smallest model the host offers.

| Tier | Claude Code            | Codex                                                 | Antigravity (agy)  |
| ---- | ---------------------- | ----------------------------------------------------- | ------------------ |
| deep | `{{claude.tier.deep}}` | `{{codex.tier.deep}}`, effort `{{codex.effort.deep}}` | `{{agy.cli.deep}}` |
| fast | `{{claude.tier.fast}}` | `{{codex.tier.fast}}`, effort `{{codex.effort.fast}}` | `{{agy.cli.fast}}` |

Not used by default: Claude `{{claude.alt.stronger}}` (more capable than `{{claude.tier.deep}}`) and `{{claude.alt.lighter}}` (lighter than `{{claude.tier.fast}}`); Codex
`{{codex.alt.frontier}}` (frontier). Use one only when the owner asks for it.

## Where each name is used

- Claude Code: the `model` on the Agent call, and the `model:` line in each `agents/<role>.md` (planner `{{claude.tier.deep}}`;
  builder and verifier `{{claude.tier.fast}}`). Keep those lines in step with this table.
- Codex: `codex exec -m <model> -c model_reasoning_effort=<effort>`, or the `model` and `effort` fields of the
  `external_worker` tool.
- agy: `agy --model <model>`, or the `model` field of the `external_worker` tool. `agy models` lists what the
  account has. An agy subagent file's `model:` field takes only `pro`, `flash` or `inherit`: use
  `pro` for deep and `flash` for fast there.

Last checked 2026-10-08 against `agy models` and Codex's model list.
