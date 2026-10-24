# Plain-writing skill revision

## Goal

Make the plain-writing skill produce general assistant responses that people can understand on the first reading, using the supplied research without trading accuracy or necessary explanation for brevity.

## Research and source facts

- Source: Thomas Hikaru Clark, Matias B. Martin, and Kyle Mahowald, _Why is AI-generated language so hard to understand?_, arXiv:2610.29162v1, 21 October 2026, supplied as `/mnt/c/Users/412mi/Downloads/2610.29162v1.pdf`. Stable attribution link: `https://arxiv.org/abs/2610.29162`. The planner extracted the actual PDF with `pdftotext -layout`; `/tmp/plain-writing-paper.txt` is a disposable extraction, not a repository artifact.
- Sections 3.1 to 3.5 examine rare word combinations, long grammatical dependencies, object relative clauses with omitted connecting words, stacked nouns, noun-derived verbs, and inanimate subjects paired with verbs that usually have animate subjects. Results vary across features, settings, and model families. Compared with round-trip paraphrases, most frontier systems overrepresent several difficulty-linked features. Human baselines are approximate genre matches; some features have no human baseline in chat and coding (Appendix B.4).
- Sections 4.1 to 4.3 give a small-model reinforcement-learning proof of concept: rewarding shorter correct event descriptions changes grammatical choices. Near transfer occurs, but far transfer is limited to one of four tested alternations, without regularization. This does not establish how frontier systems were trained or prove that every short response is difficult.
- Sections 3.4 and 7, plus Appendices A and B: English only, limited conversation seeds, simulated users, automated parsing/classification, approximate human baselines, and translation-based paraphrases. The paper measures features associated with difficulty, not comprehension improvements in a direct reader trial. Do not describe the skill's remedies as experimentally validated by this paper or prescribe translation as a rewriting workflow.
- Current entrypoint: `src/skills/plain-writing/SKILL.md`. Current supporting files: `references/revision-pass.md`, `patterns-to-avoid.md`, `rewrites.md`, `document-shapes.md`, and `machine-readers.md`.
- Conflicts to resolve: fixed 25/30-word advice encourages proxy optimization; mandatory phrase searches and document skeletons overburden ordinary replies; compulsory glossary/table/heading rules disregard the reader's task; bans on all inanimate subjects exceed the evidence. Existing examples also change meaning: the opening queue example upgrades an inference to certainty, and `rewrites.md` changes one instance per session into one shared instance. Rewrite or remove these examples rather than preserving their claims.

## Tasks

### rewrite-plain-writing

**Goal:** Replace the skill's accumulated style rules with concise, research-informed guidance that lowers a human reader's effort while preserving meaning, evidence, uncertainty, and user intent.

**Files:** Own `src/skills/plain-writing/**`. Regenerate affected files under `plugins/omnilogic-labs/skills/plain-writing/**`, `skills/plain-writing/**`, and ignored `dist/*/skills/plain-writing/**` only through `bun run build`. Do not edit other skills, compiler files, manifests, or installation logic. The coordinator owns ledger, integration, and cleanup.

**Steps:**

1. Read the actual supplied PDF, all six current source files, repository `AGENTS.md`, and `/home/mike/.codex/skills/.system/skill-creator/SKILL.md`. Use the research facts above as navigation, then check claims against the paper. Follow the skill-creator guidance on precision, progressive disclosure, intent preservation, and meaningful validation.
2. Rewrite the entrypoint around reader understanding for ordinary replies as well as documents. Prefer familiar accurate wording and explicit relationships; unpack unfamiliar noun stacks and coined labels; keep related words close; restore connecting words when omission makes a sentence harder to parse; use literal actors/actions where personification obscures meaning; explain unfamiliar terms in context. Present these as decisions for the reader and task, not universal grammatical bans. Established technical terms and conventional noun-derived verbs can remain when useful.
3. Preserve concise direct answers, necessary causal steps, useful examples, and context. State uncertainty and evidence at their original strength. Allow extra words when they save interpretation effort. Remove fixed sentence-length prescriptions and universal formatting quotas. Keep the repository's punctuation convention, clearly as a local convention rather than a research result. Respect quoted text, deliberate voice, explicit formats, and project instructions.
4. Reconcile every retained reference with the new entrypoint. Revise or remove contradictory legacy guidance and broken before/after examples. Make document shapes optional, situational starting points; keep machine-reader detail conditional and preserve human usability. Keep a lightweight final comprehension/meaning check in the entrypoint. Read longer references only when they materially help the current task.
5. Add a focused research reference if useful, linked from the entrypoint, with exact authors, title, identifier, version/date, relevant sections, practical implications, and the material limitations above. Distinguish observed results from the authors' causal hypothesis and from this skill's editorial recommendations. Do not copy large paper excerpts, add the PDF, or name models in repository files outside `hosts.ts`.
6. Add or refresh a small set of useful meaning-preserving rewrites covering the actual linguistic issues and a general explanatory response. Rewrites must preserve actors, quantities, relationships, uncertainty, and scope. Examples should make an unfamiliar relationship explicit rather than merely replace words with shorter synonyms. Avoid a large new catalog.
7. Format changed source files with the repository's formatter as appropriate, regenerate outputs, run the checks below, inspect the resulting diff for scope and stale wording, and commit the finished task branch for coordinator integration. Do not introduce implementation-mirroring tests or unrelated cleanup.

**Tier:** deep

**Depends on:** none

**Acceptance criteria**

**Checks**

1. Run `bun run build`, then `bun run build:check`; both exit 0 and generated outputs reflect only the changed source skill. Inspect `git diff --stat` and `git diff --name-only` for ownership scope. Generated files must not be edited directly.
2. Run `bun run budget` and `bash scripts/skill-stats.sh --strict`; both exit 0. The revised source skill body is at most 150 lines and description at most 300 characters.
3. Run `python3 /home/mike/.codex/skills/.system/skill-creator/scripts/quick_validate.py src/skills/plain-writing`; it exits 0. Inspect all reference links for existing targets and situational routing.
4. Run `bun run verify`; it exits 0. Record exact environmental failures if any. Do not change unrelated installation configuration to hide a failure. The coordinator may need to repeat this check after integration because installed links target the main checkout.
5. Run `bunx prettier --check src/skills/plain-writing` and `git diff --check`; both exit 0. Run `rg -n '[\x{2013}\x{2014}]' src/skills/plain-writing`; expect no matches. Inspect changed repository text for named models outside `hosts.ts`; expect none introduced.
6. Inspect the final source against the PDF: any research attribution has the exact title, all three authors, arXiv identifier/version/date and relevant sections; it includes material limitations; no claim says the paper directly tested this skill's remedies or established the training history of frontier systems. All before/after examples preserve factual content and uncertainty.

**Judged**

1. An independent verifier reviews the complete skill and references against the supplied PDF, existing source, and skill-creator guidance. Judge whether the skill gives actionable guidance about human processing effort without equating clarity with shortness, flattening technical precision, or turning aggregate research into universal prohibitions.
2. An independent verifier uses the revised skill in a disposable workspace on a short everyday explanation and an uncertain technical finding. Supply realistic requests and raw facts without an intended answer or the builder's conclusions. Judge the resulting responses for first-reading understanding, visible relationships, appropriate context, preserved evidence and uncertainty, and proportional structure. A natural readable answer matters; no word-count score or keyword assertion substitutes for this judgment.
3. The verifier checks all retained references for contradictions and assesses the before/after examples as a human reader unfamiliar with the project. The owner judges whether the resulting overall style fits their request at the milestone, without requiring a new approval step before authorized work proceeds.

## Waves

1. `rewrite-plain-writing` alone, then independent verification and coordinator integration to main.

## Risks

- The paper establishes distributional features and a limited causal proof of concept, not a validated recipe for clearer assistant answers. Keep recommendations proportionate and make their reasoning inspectable.
- Changing examples can silently change meaning; the verifier must compare assertions and uncertainty in each pair, especially existing technical examples.
- `bun run verify` checks local host installations and may depend on the main checkout. Separate environmental findings from skill defects and rerun after integration where necessary.
- No owner decisions are needed. The coordinator removes temporary plan files, branches, and worktrees after integration; only intended skill changes remain on main.
