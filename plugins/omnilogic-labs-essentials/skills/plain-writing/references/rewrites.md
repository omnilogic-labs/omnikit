# Meaning-preserving rewrites

Read these when a sentence hides relationships or a rewrite risks changing the
claim. They illustrate editorial choices, not experimentally tested remedies.
Extra words can reduce the work of interpretation. Compare the facts and
uncertainty in each pair, not just how smooth the result sounds.

## An unfamiliar noun stack

**Before**

> The account recovery request limit is five per hour.

**After**

> The limit on requests to recover an account is five per hour.

The rewrite spells out which kind of request the limit applies to. Neither
version specifies whether the limit applies per account, per user, or across
the service. A rewrite must not silently supply that missing scope.

## A missing connector and a delayed verb

**Before**

> The report the team submitted after reviewing all three sites and comparing
> their maintenance records recommends replacing the pump.

**After**

> The report recommends replacing the pump. The team submitted the report
> after reviewing all three sites and comparing their maintenance records.

The main subject reaches its verb sooner. Repeating "the team" identifies who
reviewed the sites. In a shorter sentence, adding "that" after "report" might
be enough; no grammatical construction needs to be banned.

## An unfamiliar action

**Before**

> Please calendar a review for Friday.

**After**

> Please put a review on the calendar for Friday.

The action becomes explicit. A familiar verb made from a noun, such as "email",
would not need changing merely because of its origin.

## A metaphor hiding an action

**Before**

> The retry loop swallows connection errors and tries again.

**After**

> When a connection error occurs, the retry loop suppresses the error and tries
> again.

The rewrite states the condition and action literally. "Suppresses" is useful
for a reader who knows error handling; another audience may need it explained.
Neither version says whether the error is logged, so the rewrite does not add
that claim. The inanimate subject "retry loop" remains clear and appropriate.

## A technical inference with uncertainty intact

**Before**

> Across five runs, the queue peaked between 193 KB and 262 KB against a 256 KB
> limit, suggesting memory pressure may contribute to the failure, although we
> have not isolated the cause.

**After**

> Memory pressure may contribute to the failure, but we have not isolated the
> cause. Across five runs, the queue peaked between 193 KB and 262 KB against a
> 256 KB limit.

The reader sees the tentative finding early and can inspect its evidence.
The numbers do not establish a cause or rule out a code defect. The rewrite
retains both qualifications rather than making the opening more certain.

## Scope that a smoother sentence must preserve

**Before**

> The daemon's per-session WebAssembly instance allocation means that each
> session gets one instance.

**After**

> The daemon gives each session its own WebAssembly instance.

The rewrite preserves one instance per session. "All sessions share one
instance" would describe a different design. Neither version establishes what
happens to other sessions if an instance fails.

## A general explanation

**Before**

> Wind can make you feel colder after a swim because moving air accelerates
> skin-surface water evaporation, which takes heat from your skin.

**After**

> Wind can make you feel colder after a swim because it helps water on your skin
> evaporate faster. As that water changes into vapor, it takes heat from your
> skin.

The answer connects a familiar experience to the mechanism. The rewrite explains
evaporation in context and keeps the causal chain: moving air, faster
evaporation, and heat leaving the skin. Neither version promises the same
temperature change every time.
