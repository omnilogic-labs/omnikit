# Model tiers

The coordinator names two tiers, never a model. This file is the only place a tier becomes a model name. Edit
it when a host ships new models.

- **deep:** the model we trust with planning, hard builds and milestone reviews. It is our usual choice for
  careful work, not necessarily the most capable model the host offers.
- **fast:** the model for rote building and per-task verification. It is cheaper and quicker, not necessarily
  the smallest model the host offers.

| Tier | Claude Code | Codex                         | Antigravity (agy)         |
| ---- | ----------- | ----------------------------- | ------------------------- |
| deep | `opus`      | `gpt-6.1-sol`, effort `high`  | `gemini-3.1-pro-high`     |
| fast | `sonnet`    | `gpt-6-luna`, effort `medium` | `gemini-3.8-flash-medium` |

Not used by default: Claude `fable` (more capable than `opus`) and `haiku` (lighter than `sonnet`); Codex
`gpt-6-astra` (frontier). Use one only when the owner asks for it.

## Where each name is used

- Claude Code: the `model` on the Agent call, and the `model:` line in each `agents/<role>.md` (planner `opus`;
  builder and verifier `sonnet`). Keep those lines in step with this table.
- Codex: `codex exec -m <model> -c model_reasoning_effort=<effort>`, or the `model` and `effort` fields of the
  `external_worker` tool.
- agy: `agy --model <model>`, or the `model` field of the `external_worker` tool. `agy models` lists what the
  account has. An agy subagent file's `model:` field takes only `pro`, `flash` or `inherit`: use
  `pro` for deep and `flash` for fast there.

Last checked 2026-10-08 against `agy models` and Codex's model list.
