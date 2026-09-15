# Capability tiers and reasoning

This is the canonical Night Shift policy for choosing a role's capability tier and
reasoning level. The provider-specific model mapping lives in
[`../../../roles.yaml`](../../../roles.yaml). Skills and project adapters use the
portable tier, never a provider model name.

## Tiers

| Tier | Claude | Codex | Default reasoning | Intended work |
| ---- | ------ | ----- | ----------------- | ------------- |
| 1 | Fable | Astra | medium | Planning or fixing errors that amplify through a run |
| 2 | Opus | Sol | high | Owning a unit, orchestration, and research judgment |
| 3 | Sonnet | Terra | medium | Bounded reading, grading, and integration |
| 4 | Haiku | Luna | medium on Codex, unavailable on Haiku | Explicit low-risk overrides only |

The providers' models are not claimed to be equivalent. A tier expresses the operating
choice for this roster: which jobs deserve the highest judgment, primary ownership,
bounded execution, or a deliberately cheap override. Change the provider mapping in one
place when model availability changes.

No shipped Night Shift role uses tier 4. Haiku has no reasoning control, so a tier-4
dispatch cannot preserve the common reasoning contract. Luna may be used for an explicit
low-risk Codex override at medium reasoning, but it is not a default for unattended work.

## Shipped role allocation

- Tier 1, high: planner, plan-author, fixer.
- Tier 2, high: orchestrator, delegate, planned-delegate, researcher.
- Tier 3, medium: scout, verifier, integrator, browser-buddy.

Any agent about to read a large corpus delegates that reading to the scout. Expensive roles
spend their context on judgment, not on files they will read once.

## Adapter overrides

Adapters override a role with portable values:

```yaml
overrides:
  scout: { tier: 3, reasoning: medium }
  planner: { tier: 2, reasoning: high }
```

`tier` selects the active provider's model through `roles.yaml`. `reasoning` expresses the
requested level. A provider-specific `model` or `effort` may remain in a Claude-only
adapter for compatibility, but it is not portable and must not be introduced in new shared
configuration.

Resolve independently, first value wins:

1. a provider-specific model explicitly passed at dispatch
2. a portable adapter `tier`, then its optional `reasoning`
3. the role's portable tier in `roles.yaml`
4. the active provider's model and default reasoning for that tier

The active harness determines whether it can apply a reasoning value at dispatch. Claude
pins it in agent or command frontmatter. Codex supplies it when creating an agent. Log what
actually ran, never the requested value alone.

## Dispatch record

Every dispatch records tier, provider model, and reasoning together:

```
#126 planner  tier=1 model=gpt-6-astra   reasoning=medium  (role default)
#126 delegate tier=2 model=opus          reasoning=high    (Claude mapping)
#126 scout    tier=3 model=gpt-5.6-terra  reasoning=medium  (adapter tier)
#126 verifier tier=4 model=gpt-5.6-luna   reasoning=medium  (explicit override)
```

These are log lines, not user-facing status. Mention a requested level only when the user
asked for it and the active harness could not apply it.
