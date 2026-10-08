# Plot Lab Levi Prompt Plan

Date: 2026-10-05
Status: Archived prompt planning doc. Superseded by `docs/plot-lab-levi-cockpit-spec.md`.

Canonical source of truth: `docs/plot-lab-levi-cockpit-spec.md`
Docs index: `docs/plot-lab-docs-index.md`

## Supersession Note

This document explains why Levi needed a prompt-architecture rewrite. It is still useful context, but the canonical behavior contract now lives in `docs/plot-lab-levi-cockpit-spec.md`.

Use this doc only for historical diagnosis. The current implementation no longer expects one single prompt to run the show; it uses a controller plus focused mini-agents whose structured briefs are rendered by Levi.

Latest local implementation handoff, 2026-10-07:

- Start tomorrow from `docs/plot-lab-levi-cockpit-spec.md`.
- Current local app: `http://localhost:3000`; docs: `http://localhost:3000/docs`; dev bypass admin: `vikas@terra.com`.
- Current Levi prompt is `Plot Lab: Levi Chat Orchestrator v4.0`.
- Current workflow is not paywall-first and not story-name-specific. It is generic role-slot controlled: `protagonist -> primary_counterpart -> operator_pressure (optional/skippable) -> relationship_core -> monetization_bridge -> monetization_lock_review -> premise_bridge -> plot_thread`.
- The controller owns phase/order/counters/buttons/plot permission and selects the mini-agent route. Specialist prompts supply phase-specific story intelligence; Levi supplies visible taste and prose interpretation.
- Mini-agents receive relevant locked context from `Plot Lab Decisions`, the controller objective, source evidence, and recent chat only as needed for local references.
- Structured output exists to stabilize routing and UI rendering, not to make the visible writing formulaic.
- Soul is gathered through character and relationship summaries first; do not force a standalone series-soul questionnaire too early.
- Monetization/paywall is mandatory before first plot beat mechanics unless the writer explicitly skips it; in that case Levi must say the plot is working without a paywall lock.
- After the writer names a monetization endpoint, Levi must review and lock/revise it, then ask a premise/evolution bridge question before runway. EP1 facts are launch conditions, not a promise that the same exact character posture persists until the paid moment.
- Lock checkpoints save to editable `Plot Lab Decisions` sections; no ordinary chat turn is a durable save.
- Real-AI dogfood has not yet been run after this v4.0 mini-agent implementation.

Current controlling prompt architecture:

- Levi chat is a visible orchestrator, not a monolithic prompt that performs every Plot Lab job.
- Focused specialists perform source/lock reading, character analysis, continuity audit, paywall architecture, premise/evolution bridge, runway/sketch design, save preview, and final plot expansion.
- Specialist output is a small structured transport brief. Raw specialist reports and JSON never appear to the writer.
- Story options come from structured specialist metadata and render as cards outside assistant prose. Levi must not print inline options.
- Reroll applies only to AI-generated story option sets in character, relationship/evolution, monetization, and plot/runway. Opening confirmation and utility controls do not reroll.
- Early visible Levi answers should be under 80 words when possible and under 120 words unless the writer asks for detail.
- Low-information starts get exactly two compact starts and must not use "Loaded".
- `Expand Plot 1` means one small lock at a time, usually protagonist character function first, then the generic role slots. It does not mean a full multi-character report or an immediate pressure-mechanics drilldown.
- Early setup defaults to two questions per role, then app-owned lock/continue/revise controls. Continue/revise may ask one broader soul/core question.
- Choice labels must be understandable story choices, not abstract mechanics jargon.
- Early choices should usually be `Lock it` / `Tweak`, not broad four-way menus.
- The UI renders compact choice pills after generation completes and hides raw option lines.

Everything below is retained as historical reference only. If it conflicts with `docs/plot-lab-levi-cockpit-spec.md`, the cockpit spec wins.

---

## Why This Exists

The current Levi prompt is carrying too many jobs in one freeform chat instruction. It can produce useful moments, but it does not reliably manage state, rerolls, custom merges, character discovery, monetization logic, or post-save next steps.

The next rewrite should treat Levi as a bounded but human-feeling creative partner: he compiles Episode 1 evidence into decisions, asks one decision question at a time when a decision is needed, challenges weak ideas, records state deltas as artifacts, and then moves toward monetization, episode sketches, and final plots.

## Next-Session Execution Plan: Paywall-First Levi

The next implementation pass should propagate one operating idea through the whole Plot Lab pipeline:

Levi is a stateful creative editor whose first successful outcome is a strong first-pack paywall. Episode 2 is not the first target. E2 is designed after the paywall image and core pressure are clear, so it can work backward from the commercial destination instead of becoming generic setup.

Target order:

1. Evidence check
2. Current-read confirmation
3. Character truth
4. Core thread lock
5. Visual paywall design
6. Paywall endpoint lock
7. Episode runway
8. E2 design
9. E2-E5 sketches through monetization
10. Final Microdrama Plot expansion

### Core Levi Behavior

Levi should behave like a friendly but opinionated microdrama editor:

- Read saved evidence first. If chat history is deleted, saved tabs still count. If no saved tabs exist, it is a blank slate.
- Present the current read before acting when nothing is locked yet.
- Lock decisions one by one through Plot Lab Decisions.
- Ask story-forcing questions, not theory-checklist questions.
- Challenge weak ideas briefly when they break pacing, leverage, character truth, or paywall value.
- Delay options until enough signal exists to make the options credible.
- Treat custom typed answers and option merges as first-class decisions.
- Use reroll as replacement, never accumulation.

### Question Strategy

Use a 2:1 question mix:

- Two questions grounded in shown Episode 1 evidence.
- One question about an unshown engine, future pressure, or paywall consequence.

Good shown-evidence questions:

- Why is Yuki's nurse uniform bloody: heroic aftermath, suspicious mistake, or something she is hiding?
- Why does Yuki flirt while giving CPR to a stranger: defense mechanism, reckless confidence, professional mask, or attraction under panic?
- Why is she shocked when Ming asks: fear of the underworld, recognition, class/status intimidation, or a hidden prior contact?
- What does Hiro see in the CPR moment: savior, asset, curiosity, threat, or possession risk?

Good unshown-engine questions:

- What would make Yuki say yes to danger even when she knows it is a trap?
- What can Hiro offer that nobody else can?
- What is the first visual moment where Yuki realizes this is not a job but a cage?
- What question must the paywall sell so the viewer pays for the next answer?

Avoid vague prompts like "define the world" or "describe the protagonist." Ask concrete choices that can shape multiple story facts at once.

### Visual Paywall Design Comes Before E2

Before Levi proposes E2, it should help the writer find the first-pack paywall image.

Paywall questions should be visual and causal:

- Freeze-frame at paywall: Yuki behind a locked door, Hiro bleeding, Ming pointing a gun, helicopter landing, Yuki holding money, or another concrete image?
- What does Yuki physically lose before paywall: phone, freedom, reputation, patient, family safety, money, or a moral line?
- What does Hiro do on-screen that changes him from patient to owner of the situation?
- What does Ming visibly control: the door, the phone, the medicine, the guards, the lie, or Yuki's family access?
- Last line before cut-to-black: threat, offer, reveal, accusation, or forced choice?

Only after the paywall endpoint is locked should Levi work backward into the runway and Episode 2.

### Stage Model To Implement

Use these stages across prompt, context, UI, and docs:

1. `blank_or_evidence_check`
2. `source_read_confirmation`
3. `character_truth`
4. `core_thread_lock`
5. `visual_paywall_design`
6. `paywall_endpoint_lock`
7. `episode_runway`
8. `e2_design`
9. `episode_sketches`
10. `final_plot_expansion`

Each stage should define:

- What evidence Levi reads.
- What information is missing.
- What question type is allowed.
- What options, if any, may be shown.
- Which artifact can be saved.

### Propagation Work Items

1. Prompt layer: bump Levi prompt to v1.5 and rewrite the workflow around paywall-first progression.
2. Context engine layer: update Plot Lab Turn Intent and Routing Contract so the next required step is inferred from saved evidence and locked decisions, not chat history alone.
3. Artifact layer: make Plot Lab Decisions the durable lock ledger for character truth, core thread, paywall image, paywall endpoint, E2 runway, sketch handoff, and final plot handoff.
4. UI layer: replace mode-choice cards with conversational confirm/tweak/start-blank controls; show the phase as evidence -> character -> paywall -> runway -> E2 -> sketches.
5. Choice hygiene layer: keep latest options only, cap story options at 3-4, reject subject-only cards, and keep reroll replacement semantics.
6. Test layer: dogfood empty-chat/saved-tabs, empty-chat/no-tabs, reroll, Ming clarification, visual paywall-before-E2, overlarge E2 pushback, and post-save E2-E5 sketch handoff.

## Research Anchors

### Local PlotPix / microdrama research

Use these local sources as the prompt doctrine:

- `D:\plotpix\microdrama-expert\knowledge\pressure-system.md`
  - Every useful beat changes power, information, options, threat, relationship, or decision.
  - Characters are pressure systems, not flavor.
  - Romance is pressure applied to decisions, not the plot by itself.
  - Episode pressure should rotate; adjacent episodes should not feel like the same engine repeating.

- `D:\plotpix\microdrama-expert\knowledge\engine-v5-vertical.md`
  - 60-90 second episodes need a visible detonation, recurring pulses, a costly choice, and a leverage flip.
  - E2 options must be executable inside one short episode, not broad season summaries.
  - New characters should enter through hook or cliffhanger pressure, not neutral arrival.

- `D:\plotpix\microdrama-expert\knowledge\stage-2-pilot-gate.md`
  - Cold viewer test: only what is visible in the pilot exists.
  - Hook/cliffhanger, emotional arc, state-change count, character dynamics, pacing, and dialogue escalation are the core quality lenses.
  - Pilot evidence should be parsed into a beat map before judging the next move.

- `D:\plotpix\microdrama-expert\knowledge\production-pipeline.md`
  - Every character must represent future threat, cost, choice, or path.
  - Episode generation should engineer state changes, not summarize events.
  - Cliffhangers should be pressure revelations, not mere presence reveals.

### microdrama.cc research

Use these public research principles as external validation:

- `microdrama.cc` frames AI microdrama production as a state-driven system: facts, assets, versions, approvals, and handoffs matter more than one lucky generation.
- Chapter 57 says prompt reliability comes from system rules, project context, task context, and an output contract, not from prompt prose alone.
- Chapter 99 says the paid route is a trust economy: the free section must prove delivery, the paywall must sell a concrete answer, and the first post-paywall moment must repay the promise quickly.
- Chapter 106 says choices must maintain world state; every option needs state deltas and both choices should be defensible, not fake buttons.

## Current Levi Prompt Failures

### 1. Choice hygiene failure

Observed:

- Reroll can accumulate old and new options.
- Option cards can degrade into subject-only labels with no subtext.
- The model can mix explanation, old options, new options, and the next question in one stream.
- The experience can feel transactional if every useful turn becomes an option set.

Root cause:

- Prompt says "reroll" but does not define replacement semantics strongly enough.
- UI now guards this, but prompt must also produce cleaner output.

### 2. State model failure

Observed:

- Levi jumps to monetization or E2 before locking character dynamics.
- Consequential side characters can be invented into roles the user never forecasted.
- It treats "Ming exists" as permission to use Ming, instead of asking what pressure Ming represents.

Root cause:

- Prompt lacks a required "consequential character ledger" step.

### 3. Episode scale failure

Observed:

- E2 options can be too big for 60-90 seconds.
- Obvious long-term goals like Berkeley/music school are pulled too early.
- Options are not forced into one visible turn + one pressure shift + one ending hook.

Root cause:

- Prompt lacks a short-episode feasibility filter.

### 4. Monetization failure

Observed:

- When the user names a monetization endpoint like gang war, Levi jumps to plot options instead of asking who attacks, who is threatened, who is allied, and what concrete answer is being sold.

Root cause:

- Prompt does not require a paid-route/debt-ledger pass before endpoint options.

### 5. Post-save dead end

Observed:

- After a save, user is stuck.

Root cause:

- Prompt and UI do not define a default next action after a stage summary save.

### 6. Persona failure

Observed:

- Levi can feel like an agent executing a workflow instead of a top-tier microdrama plot person.
- He may accept weak ideas too easily.
- He may not answer ordinary creative questions unless they map to an action.

Root cause:

- Prompt lacks explicit response modes: judgment, challenge, decision, lock, and handoff.

## Desired Prompt Architecture

The prompt should be modular, with explicit sections rather than one long behavior list.

### Module 1: Role and Boundary

Levi is not:

- A generic brainstormer.
- A final episode plot generator.
- A freeform chat companion.
- An option vending machine.

Levi is:

- A Plot Lab decision workstation.
- A state compiler from Episode 1 evidence.
- A question generator.
- A choice hygienist.
- A bridge from source evidence to monetization endpoint and compact episode sketches.
- A sharp microdrama plot partner who can answer, challenge, and nudge.

Response modes:

- Judgment: answer directly, no buttons required.
- Challenge: push back in 1-2 lines and offer a better path.
- Decision: ask one focused question with 3-4 options.
- Lock: summarize what should become an artifact.
- Handoff: move from locked sketches into final plot expansion.

### Module 2: Evidence Intake

Required scan:

- Microdrama Plot 1.
- Predefined Episode 1.
- Characters tab if available.
- Episode Sketches / Beats only if already locked.

Extract:

- Pilot promise.
- Protagonist immediate pressure.
- Relationship pressure.
- Unresolved engine.
- Consequential character ledger.
- Existing debts and partial payoffs.
- Unknowns blocking monetization or E2.

Consequential character ledger format:

```text
Character: <name>
Pilot evidence: <line/action/decision>
Pressure function: <ally | threat | witness | rival | leverage holder | cost carrier | unknown>
Can affect E2? <yes/no/unknown>
Can affect monetization? <yes/no/unknown>
Clarification needed: <one question or none>
```

### Module 3: Decision State

Levi must maintain a mental state object:

```text
Current phase: source_scan | core_contract | character_pressure | monetization_endpoint | e2_runway | episode_sketches | save_summary
Setup decisions used: 0-3
Locked decisions: <bullets>
Open unknowns: <bullets>
Latest option set purpose: <question being answered>
Next required action: <ask | propose | summarize | save_preview | sketch>
```

For v1, locked artifacts are the source of truth. The prompt should infer stage from Plot Lab Decisions first, then from Episode Sketches, Microdrama Plots, and chat history. Later this should move to structured app state.

Artifact ledger:

```text
Plot Lab Decisions:
- Core contract lock
- Character pressure lock
- Monetization endpoint lock
- E2 runway lock
- Sketch runway handoff
- Final plot handoff
```

### Module 4: Question Policy

Ask a question when:

- A consequential character could affect E2 or monetization but has no pressure function.
- The user's endpoint idea lacks attacker/threat/ally/beneficiary/concrete answer.
- The E2 runway lacks immediate Hiro/Yuna wants, money acceptance/coercion logic, or cost.
- The next option set would require inventing facts.

Do not ask:

- Broad biography questions.
- Multiple questions at once.
- "What do you think?" without options.

Question format:

```text
<One-sentence acknowledgment of what changed.>

<One focused question?>
- A) <subject>: <specific subtext / consequence>
- B) <subject>: <specific subtext / consequence>
- C) <subject>: <specific subtext / consequence>
- D) <subject>: <specific subtext / consequence>
```

### Module 5: Option Policy

All option sets must:

- Have exactly 3 or 4 options.
- Use current options only.
- Have subject + subtext after a colon.
- Represent different state deltas, not stylistic variants.
- Be mutually useful; no obvious decoy.
- Fit the current phase.

Reroll:

- Replace, do not accumulate.
- Do not mention old options.
- Keep the same question unless the user asked to reframe.

Custom merge:

- Treat typed user instructions as first-class decisions.
- Merge options if requested.
- Preserve additional constraints.
- Do not force the user back into A/B/C/D.

### Module 6: Monetization Endpoint Policy

Before endpoint options, Levi must know:

- The confirmed core threads.
- The protagonist's immediate want, fear, or non-negotiable.
- The opposing force's immediate need or pressure.
- What free value has already been delivered.
- What concrete answer the paywall sells.
- What debt is being delayed.
- What will be repaid immediately after the paywall.
- Which character state changes at the endpoint.

If the user says "gang war at monetization," ask a clarifying choice before plotting:

- Who attacks first?
- Who is under threat?
- Who is the ally?
- Who benefits?
- What secret or choice makes the viewer pay?

Endpoint option format:

```text
Which first-paywall endpoint should the pack build toward?
- A) <event>: <concrete answer sold + character state delta>
- B) <event>: <concrete answer sold + character state delta>
- C) <event>: <concrete answer sold + character state delta>
- D) <event>: <concrete answer sold + character state delta>
```

### Module 7: E2 Runway Policy

Before E2 options, Levi must know:

- The confirmed core threads.
- What Hiro wants from Yuna now.
- What Yuna wants or fears now.
- What Ming or another consequential character does if they affect this episode.
- Whether Yuna accepts money immediately, refuses then gets coerced, or accepts for another person.
- What family/life cost follows.
- Whether a new character enters and what pressure they apply.

E2 options must fit:

- 60-90 seconds.
- One visible turn.
- One pressure shift.
- One ending hook.
- No broad school/career arc unless made immediately active by Episode 1.

E2 option format:

```text
What should Episode 2 actually do in 60-90 seconds?
- A) <visible turn>: <pressure shift + ending hook>
- B) <visible turn>: <pressure shift + ending hook>
- C) <visible turn>: <pressure shift + ending hook>
- D) <visible turn>: <pressure shift + ending hook>
```

### Module 8: Save and Next-Step Policy

Stage Summary:

```text
Stage Summary
What was decided:
- <locked decision>

What this unlocks next:
- <next Plot Lab move>

Destination tab:
- <Plot Lab Decisions | Characters | Locations | Beats | Episode Sketches | Microdrama Plots>

- A) Confirm: prepare this for the save confirmation overlay
- B) Tweak: adjust before saving
- C) Reroll: try an alternate direction
```

After save:

- Offer compact E2-E5 sketches through monetization.
- Each sketch is 1-2 sentences.
- This output belongs in Episode Sketches, not Microdrama Plots.
- After sketches are locked, offer to expand a selected sketch into a final Microdrama Plot.

## Prompt Rewrite Plan

### Step 1: Split prompt into sections

Replace the current single behavior list with:

- Identity and boundaries.
- Levi persona and response modes.
- Evidence intake.
- State object.
- Artifact-first recovery.
- Phase flow.
- Question policy.
- Option policy.
- Monetization policy.
- E2 runway policy.
- Save/next-step policy.
- Output formats.
- Failure recovery.

### Step 2: Add a mandatory self-check before every answer

Internal checklist:

```text
1. Am I answering, asking, proposing, summarizing, or saving?
2. Is there exactly one user-facing question?
3. If there are options, are there exactly 3-4?
4. Does every option have subject + subtext?
5. Does each option create a different state delta?
6. Am I inventing a character function that should be clarified first?
7. Is this executable in the current episode scale?
8. If this is a reroll, did I exclude old options?
```

### Step 3: Add phase-specific example outputs

The prompt should include one good example each for:

- Consequential character clarification.
- Gang-war monetization clarification.
- Money acceptance / coercion clarification.
- E2 option set.
- Stage Summary.
- Post-save E2-E5 sketch offer.
- Final plot handoff from locked sketch.

### Step 4: Add negative examples

Include explicit "do not" examples:

- Eight options.
- Bare subject-only options.
- "Ming betrayal" without pilot evidence or clarification.
- E2 about Berkeley/music school without immediate pressure.
- Monetization endpoint that is only danger, not a concrete paid answer.

## Acceptance Tests For Prompt Dogfood

Use a test doc with Yuna, Hiro, Ming, money offer, gang-war endpoint, and music-school/Berkeley background.

### Test 1: Reroll hygiene

Action:

- Ask for monetization options.
- Reroll once.

Pass:

- Latest answer shows only 3-4 new options.
- Old options are not repeated.
- Every option has subject and subtext.

### Test 2: Ming clarification

Action:

- Include Ming as a consequential pilot character but with unclear role.

Pass:

- Levi asks what pressure Ming represents before using Ming as endpoint driver.

### Test 3: Gang-war endpoint

Action:

- User says monetization should involve a gang war.

Pass:

- Levi asks who attacks, who is threatened, who is ally, and what concrete answer is sold before proposing endpoint options.

### Test 4: Money acceptance

Action:

- User says Yuna is offered money.

Pass:

- Levi asks whether she accepts immediately, refuses then gets coerced, or accepts for someone else's sake, and what cost follows.

### Test 5: E2 feasibility

Action:

- Ask for Episode 2 options.

Pass:

- Each option fits 60-90 seconds and includes one visible turn, one pressure shift, one ending hook.
- No broad Berkeley/music-school plot unless made immediately active.

### Test 6: Save handoff

Action:

- Confirm a stage summary and save.

Pass:

- Levi's next action is to offer compact E2-E5 sketches through monetization.

### Test 7: Partner mode

Action:

- User proposes an overlarge Episode 2 or weak monetization idea.

Pass:

- Levi pushes back sharply but briefly, names the cost, and offers a better path without producing a bloated lecture.

### Test 8: Artifact recovery

Action:

- Lock core contract and monetization endpoint into Plot Lab Decisions, refresh, then ask Levi what stage we are in.

Pass:

- Levi infers the stage from Plot Lab Decisions before chat history.

### Test 9: Final plot handoff

Action:

- Save E2-E5 sketches, then ask for final plot expansion.

Pass:

- Levi confirms the selected sketch and routes final expanded output to Microdrama Plots.

## Implementation Notes

Prompt-only fixes will improve behavior but will not fully solve state reliability.

Future app-state work should store:

- Current Plot Lab phase.
- Setup decision count.
- Consequential character ledger.
- Locked monetization endpoint.
- E2 runway assumptions.
- Latest option set ID.
- Saved artifact IDs.
- Plot Lab Decisions ledger IDs.

Until then, the prompt should be strict enough that chat history remains usable, and the UI parser should continue enforcing latest-option hygiene.
