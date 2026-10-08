# Plot Lab Product Contract

Date: 2026-10-05
Status: Archived product contract. Superseded by `docs/plot-lab-levi-cockpit-spec.md`.

Canonical source of truth: `docs/plot-lab-levi-cockpit-spec.md`
Docs index: `docs/plot-lab-docs-index.md`

## Supersession Note

This document captures the earlier paywall-first product plan. It is useful background, but it is no longer the controlling contract for UI, UX, prompt behavior, state behavior, locking, feedback, mini-agent routing, or implementation.

Use this doc only when you need historical context on why Plot Lab moved away from a simple paywall-first prototype. Do not implement from the sections below without checking the cockpit spec first.

Latest local implementation handoff, 2026-10-07:

- Start tomorrow from `docs/plot-lab-levi-cockpit-spec.md`, not this historical product contract.
- Current localhost entry point is `http://localhost:3000`; docs are at `http://localhost:3000/docs`; dev bypass admin is `vikas@terra.com`.
- Current Levi prompt is `Plot Lab: Levi Chat Orchestrator v4.0`.
- Current implementation uses controller-routed mini-agents: source/lock reader, character analyst, paywall architect, premise bridge architect, runway designer, and continuity auditor. Levi renders the concise visible chat.
- Specialist JSON is only an internal transport envelope. The writer sees concise natural-language Levi text and UI-rendered choices, never raw JSON or inline option lists.
- Current Levi workflow is character-first and role-slot-gated: `protagonist -> primary_counterpart -> operator_pressure (optional) -> relationship_core -> monetization_bridge -> monetization_lock_review -> premise_bridge -> plot_thread`.
- This supersedes the earlier paywall-first framing in this document. Paywall/monetization is still important, but it comes after the role/relationship chain and before first plot beat mechanics.
- The controller owns role order, default two-question caps, checkpoint buttons, Add Context behavior, plot-detail permission, monetization review, premise/evolution bridge, and plot runway gating.
- V1 does not parse full creative meaning into controller state. It tracks lightweight role-slot and monetization statuses while mini-agents return structured internal briefs and Levi carries creative nuance in prose summaries.
- Lock checkpoints save to the editable `Plot Lab Decisions` tab in stable sections, and the app opens that tab after a lock save.
- Thumbs up/down plus notes are feedback diagnostics. They log response quality and state context; they do not advance workflow or save locks.
- Real-AI dogfood has not yet been run after the v4.0 mini-agent implementation.

Current controlling decisions:

- Plot Lab remains a three-pane workspace: tabs, editor/artifact canvas, Levi chat.
- The third pane is chat-only plus compact latest-choice buttons.
- The simple admin/debug panel should show only what the writer needs to understand backend state: phase, focus, waiting-for state, save target, locks, next move, and repetition warning.
- Do not add visible workflow rails, context dashboards, story progression cards, quality gates, scratch notes, or artifact dashboards.
- Levi should not greet with "Loaded", a recap dump, or a mode menu.
- Levi should not answer an early option click with a full multi-character report.
- Levi should work one small lock at a time: protagonist character function, then primary counterpart / gravity character, then optional operator / pressure face, then relationship chain, then monetization/paywall bridge, then monetization review, then premise/evolution bridge, then plot beats.
- Early setup defaults to two questions per role. The writer can choose to continue, revise, reroll, or lock/move on before Levi changes state.
- Choice labels must be understandable story choices, not abstract mechanics jargon.
- Levi chat is the visible orchestrator; specialist prompts now support it through structured internal briefs, not loose hidden reports.
- Series soul and character soul are first-class Plot Lab responsibilities and save to Plot Lab Decisions in V1.

Everything below is retained as historical reference only. If it conflicts with `docs/plot-lab-levi-cockpit-spec.md`, the cockpit spec wins.

---

## Purpose

Plot Lab helps a writer turn Episode 1 evidence into a coherent first-pack runway: enough character truth to choose a strong visual monetization/paywall endpoint, then compact episode sketches from E2 through that monetization point.

The product is not a generic chat brainstormer, and Levi is not an option vending machine. Levi is an expert microdrama brainstorming partner: concise, opinionated, able to challenge weak ideas, able to answer normally, and able to turn good decisions into locked artifacts only when the writer confirms a stage summary.

## Primary Outcome For Current Version

The current version succeeds when Levi helps the writer lock the first-pack paywall, then works backward into Episode 2 and the E2-E5 runway.

Canonical order:

1. Evidence check from saved tabs.
2. Current-read confirmation.
3. Character truth questions.
4. Core thread lock.
5. Visual paywall design.
6. Paywall endpoint lock.
7. Episode runway.
8. Episode 2 design.
9. E2-E5 sketches through monetization.
10. Final Microdrama Plot expansion from locked sketches.

Episode 2 is not the first target unless the writer explicitly asks to work E2-first. Levi should usually find the paywall image before pitching E2, because E2 should be engineered backward from the commercial destination.

## Core UX Principle

The writer should always know:

- What Levi just understood.
- What Levi believes is already locked.
- What decision Levi is asking for now.
- What actions are available.
- What will happen if they click or type.
- What was saved and what the next step is.

## Levi Persona Contract

Levi should feel like a sharp creative partner, not a transactional agent.

Levi can:

- Answer a story question directly without showing choices.
- Push back on a weak idea by naming the story cost and offering a stronger route.
- Ask the writer which path to take when multiple valid creative paths exist.
- Nudge the writer back to monetization, E2 runway, or character pressure when the conversation drifts.

Levi should not:

- Produce buttons on every turn.
- Over-explain process.
- Hide behind generic "as an AI" caveats.
- Accept bad story logic just because the user suggested it.

Pushback standard:

- Sharp but bounded.
- One or two lines on the problem.
- One better path or one focused question.

## Main Plot Lab Use Cases

### 1. Source scan from Episode 1

Input:

- Microdrama Plot 1
- Predefined Episode 1
- Source/original research as support
- Existing Characters/Locations if available

Levi output:

- Core promise of Episode 1
- Protagonist pressure
- Relationship pressure
- Unresolved engine
- Consequential character scan

Consequential character scan means named or distinct characters who speak, choose, threaten, reveal, withhold, create consequences, or could plausibly drive monetization. Ignore pure extras and generic henchmen unless they change the plot.

Required action:

- Ask one decision question. Do not propose options before the core threads are clarified.

### 1.5 Core thread clarification

Goal:

- Lock what the series is really about before Levi starts optioning.

Levi should ask 1-2 targeted questions before proposing core-thread options. It should clarify:

- Is the engine captivity, a deal, care turning into control, survival pressure, dream pressure, or some combination?
- What does the protagonist refuse to lose right now?
- What does the opposing force need right now?
- Which consequential side character, if any, changes the pressure?

After those answers, Levi should state a short working core-thread lock and ask the writer to confirm or tweak. Only then should Levi propose 3-4 core-thread options.

### 2. Character and relationship discovery

Goal:

- Decide immediate wants and pressure, not full character biographies.

Levi should ask about characters when:

- A consequential pilot character appears but their story function is unclear.
- A monetization option would require inventing that character's motive.
- E2 depends on a relationship dynamic that has not been locked.

Examples:

- If Ming appears consequentially, Levi should ask whether Ming is ally, threat, witness, rival, pressure valve, or future betrayal vector before building monetization around her.
- If Hiro/Yuna dynamics are unclear, Levi should ask what Hiro needs immediately and what Yuna cannot afford to lose before proposing Episode 2.

### 3. Monetization endpoint design

Goal:

- Pick the strongest first-pack paywall endpoint, not the Episode 1 cliffhanger.
- Get the writer thinking visually before optioning the endpoint.

Levi should not jump from a vague endpoint like "gang war" to final options. It should ask spark-clarity questions first:

- Who attacks first?
- Who is under threat?
- Who is secretly an ally?
- Who benefits if the attack succeeds?
- What choice or secret makes the viewer pay to resolve it?

Monetization options must explain:

- What happens.
- Why it is monetization-friendly.
- What emotional/story question it forces.
- What next-pack promise it opens.

Before endpoint options, Levi should ask visual pressure questions such as:

- What is the freeze-frame at the paywall?
- What does the protagonist physically lose before the cut?
- What does the opposing force do on-screen that changes the power balance?
- Which object, location, wound, door, phone, vehicle, weapon, medicine, money, or public exposure makes the moment legible?
- What exact answer is the viewer paying to get?

### 4. Immediate E2 runway

Goal:

- Build the next executable 60-90 second episode, not a broad season move.

Episode 2 options must include:

- One visible turn.
- One pressure shift.
- One ending hook.

Episode 2 must not over-index on obvious long-term goals like Berkeley/music school unless Episode 1 makes them immediately actionable. Long-term goals should usually remain background pressure while the episode plays through a more concrete immediate event.

Before proposing Episode 2, Levi should know:

- What Hiro wants from Yuna now.
- What Yuna wants or fears now.
- What Ming or another consequential character does in the scene if they affect E2.
- Whether Yuna accepts money immediately, refuses then gets coerced, or accepts for someone else's sake.
- What cost the decision creates for Yuna, her family, or the relationship.
- Whether a new character enters E2 and why that is executable in 60-90 seconds.

### 5. Episode sketch runway after save

After a stage summary is saved, the user should not be stuck.

Default next action:

- Offer to generate E2, E3, E4, E5 through the monetization point as compact sketches.

Sketch standard:

- 1-2 sentences per episode.
- Driver, visible turn, ending pressure.
- Not final Microdrama Plots.

### 6. Final plot expansion after sketches

After E2-E5 sketches are locked, Levi may help expand a selected sketch into a final Microdrama Plot.

Rules:

- Confirm which locked sketch is being expanded.
- Use Episode Sketches as source material.
- Save final expanded plots into Microdrama Plots only.
- Do not skip from early brainstorming directly to final plots.

## Artifact-First State

Levi should recover stage from locked artifacts first, then chat history.

Primary artifact:

- Plot Lab Decisions: core contract locks, character-pressure locks, monetization endpoint locks, E2 runway decisions, sketch runway handoffs, and final plot handoffs.

Supporting artifacts:

- Characters
- Locations
- Beats
- Episode Sketches
- Microdrama Plots

If Plot Lab Decisions conflicts with chat history, Levi should surface the conflict and ask which one governs before continuing.

## Supported User Actions

### Choose an option

The user clicks a card. Levi treats it as the current decision and moves to the next smallest question.

### Reroll

Reroll replaces the current option set.

Rules:

- Do not show old options again.
- Do not compare old vs new.
- Output exactly 3 or 4 current options.
- Every option needs subject plus subtext.

### Custom merge / custom instruction

The user can type a merge, for example:

> Merge A and C, but make Ming an accidental witness rather than a villain.

Levi must treat the typed answer as the real decision. It should not force the user back into one of the original choices.

### Clarify before options

If Levi lacks a key fact, it should ask one clarifying question with choices instead of producing bad options.

Mandatory order:

1. Greeting or empty test turn: acknowledge saved context only.
2. Core threads: ask 1-2 targeted questions.
3. Working core-thread lock: ask confirm/tweak.
4. Character motivations: clarify immediate wants and pressure.
5. Visual monetization/paywall design: ask concrete freeze-frame and loss/leverage questions.
6. Paywall endpoint options: only after enough character/core pressure exists.
7. Episode 2 and episode runway: only after paywall direction is locked, unless the writer explicitly asks to work E2-first.

### Confirm stage summary

Only Stage Summary confirmation routes into the save-preview flow.

Stage Summary must include:

- What was decided.
- What this unlocks next.
- Destination tab.

### Save

The double-confirm overlay writes to the appropriate ANW tab.

After save:

- Levi should offer the next action, usually compact episode sketches through monetization.
- After sketches are saved, Levi should offer final Microdrama Plot expansion from a selected locked sketch.

## Option Hygiene Rules

- Latest actionable message only.
- Exactly 3 or 4 story options.
- No accumulated reroll history.
- No subject-only cards.
- No mixed old/new choices.
- One question at a time.
- Answer and next question should be visually separable.
- If the model streams a long answer, the future UX should consider hiding actions until the answer is complete and rendering the final option set as a stable action block.

## Prototype Limitations To Fix Later

- The current implementation still uses chat history as the main state. A production version should store structured Plot Lab state: current stage, decision count, consequential characters, locked monetization endpoint, current E2 assumptions, latest option set, and saved artifacts.
- V1 now has a Plot Lab Decisions ledger, but deeper structured state is still client/session-led. A production version should store current phase, decision count, consequential character ledger, locked monetization endpoint, E2 assumptions, latest option set, and saved artifact IDs as explicit app state.
- Streaming text currently mixes reasoning and actions in one bubble. A later UI should separate "Levi understood" from "Choose next" with a stable action panel.
- The chat box is currently the custom merge mechanism. Later, each option card could have a "Use as base" action that pre-fills the composer.
