# Host facts for the compile step

Measured on 2026-10-08 with codex-cli 0.161.0 and agy 1.3.1. Tests used `zz-hf-*` names, all removed afterwards.
Run codex and agy with `< /dev/null`, otherwise `codex exec` waits on stdin and hangs.

Listing at the start (before any test file), from `ls ~/.codex/agents ~/.gemini/config/agents ~/.agents/skills
~/.gemini/config/skills ~/.codex/skills 2>/dev/null`:

- `~/.codex/agents`: absent
- `~/.gemini/config/agents`: absent
- `~/.agents/skills`: agent-browser artistic-vision coordinator onepassword plain-writing primer render
- `~/.gemini/config/skills`: the same seven
- `~/.codex/skills`: `.system` only

## (a) Does agy load a SKILL.md with unknown frontmatter keys?

Test: `~/.gemini/config/skills/zz-hf-test/SKILL.md` with `license: MIT`, `metadata: {a: b}`, `x-test: 1` beside
`name` and `description`.

Command: `agy -p "Use the zz-hf-test skill if you have it and tell me what it says. If you do not have a skill by
that name, say NOSKILL." --mode plan --sandbox < /dev/null`

Result: agy loaded the skill and quoted its body (AGYTEST). No warning or skip. Codex also loaded a skill with the
same extra keys from `~/.codex/skills`.

Answer: yes (unknown keys are tolerated, so no per-host key filtering is needed)

## (b) Does Codex read `~/.codex/skills` as well as `~/.agents/skills`, and which wins on a duplicate?

Test: skill `zz-hf-dup` in both dirs with different bodies (FROM-AGENTS, FROM-CODEX).

Command: `codex exec --skip-git-repo-check -s read-only "<list every skill starting zz-hf with its path, read each
zz-hf-dup SKILL.md>" < /dev/null`

Result: both dirs are read. Codex listed both `zz-hf-dup` entries (roots `r0` = `~/.codex/skills`, `r1` =
`~/.agents/skills`), so neither wins; it shows duplicates side by side. Link into only one dir to avoid two entries.
`~/.agents/skills` is the shared root (also read by other hosts), so install there.

Answer: yes (both read; no winner, both listed)

## (c) Does Codex load a custom agent from `~/.codex/agents/<name>.toml`?

Test file `~/.codex/agents/zz-hf-agent.toml`:

```toml
name = "zz-hf-agent"
description = "Test agent. Replies with the marker ZZ-AGENT-OK."
developer_instructions = """
You are a test agent. Reply with exactly: ZZ-AGENT-OK
"""
model = "gpt-6-luna"
model_reasoning_effort = "low"
```

Command: `codex exec --skip-git-repo-check -s read-only "Spawn the custom agent named zz-hf-agent using your subagent
tool (spawn_agent with agent_type zz-hf-agent), wait for it, and report its reply and the exact tool call
arguments you used." < /dev/null`

Result: the agent loaded and replied `ZZ-AGENT-OK`. Accepted field names: `name`, `description`,
`developer_instructions`, `model`, `model_reasoning_effort`. A session invokes it as `spawn_agent` with
`agent_type: "<name>"`, plus `message`, `task_name` and `fork_turns` ("none"), then `wait_agent` with `timeout_ms`.

Answer: yes (fields: name, description, developer_instructions, model, model_reasoning_effort)

## (d) Which frontmatter keys does an agy agent file in `~/.gemini/config/agents/` accept?

Test file `~/.gemini/config/agents/zz-hf-agent.md` with `name`, `description`, `model`, `tools: [read_file]` and
`x-bogus: 1`.

Commands: `agy agent < /dev/null` (lists loaded agents) and `agy -p "Invoke the subagent named zz-hf-agent with
invoke_subagent ..." --mode plan --sandbox < /dev/null`

Result: the agent was listed and invoked via `invoke_subagent` (arg `TypeName: "zz-hf-agent"`, reply `ZZ-AGY-OK`).
`model: flash`, `pro` and `inherit` all load. An invalid model (`zz-nonexistent-model`) makes the agent vanish from
`agy agent` and invoke fails with `not found or not allowed`, so emit only valid values. Unknown keys such as
`x-bogus` and `tools` did not stop loading; agy did not report whether `tools` is honored (unverified).
Agent files also load with no `tools` key.

Answer: name, description, model (pro|flash|inherit); `tools` and unknown keys tolerated, `tools` effect unverified

## Cleanup

All test files removed, including the `~/.codex/agents` and `~/.gemini/config/agents` dirs created for the tests, so
the listing matches the start listing above.
