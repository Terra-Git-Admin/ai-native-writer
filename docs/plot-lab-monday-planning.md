# Plot Lab Archived Monday Planning Scratchpad

Date: 2026-10-01
Status: Archived scratchpad. Superseded by `docs/plot-lab-levi-cockpit-spec.md`.

Canonical source of truth: `docs/plot-lab-levi-cockpit-spec.md`
Docs index: `docs/plot-lab-docs-index.md`
Archived companion docs: `docs/plot-lab-product-contract.md`, `docs/plot-lab-levi-prompt-plan.md`

## Why This File Still Exists

This was a one-off planning scratchpad from the earlier Monday pass. It is not a weekly plan, not an active roadmap, and not a product contract.

It remains in the repo only to preserve the history of how the prototype moved from "every question needs choices" and "three setup decisions before monetization" toward the current design: character-first role slots, mandatory locks, focused mini-agents, editable `Plot Lab Decisions`, no inline options, and a minimal debug panel.

Do not start implementation from this file. Use the cockpit spec.

## Latest Local Handoff - 2026-10-07

This document is no longer the working contract. Use `docs/plot-lab-levi-cockpit-spec.md` as the starting point.

Current local state:

- Workspace: `D:/codex-global/anw-plot-lab-v1`
- Branch: `feat/plot-lab-v1`
- Dev URL: `http://localhost:3000`
- Docs URL: `http://localhost:3000/docs`
- Dev bypass admin: `vikas@terra.com`
- Levi prompt: `Plot Lab: Levi Chat Orchestrator v4.0`
- Prompt architecture: controller-routed mini-agents now feed Levi through structured internal briefs; Levi renders the concise writer-facing chat.
- Workflow: `protagonist -> primary_counterpart -> operator_pressure (optional/skippable) -> relationship_core -> monetization_bridge -> monetization_lock_review -> premise_bridge -> plot_thread`
- Controller owns first confirmation, Add Context, role order, default two-question caps, checkpoint buttons, plot-detail permission, mini-agent route, monetization review, premise/evolution bridge, and plot runway gating.
- Lock checkpoints save to editable `Plot Lab Decisions` sections and open that tab after saving.
- The admin/debug panel is intentionally minimal: phase, focus, waiting-for state, save target, locks, next move, active mini-agent, locked context used, repetition warning, and save status.
- Current implementation is generic. Do not hardcode story identifiers in reusable prompt/controller logic.
- Paywall/monetization still matters, but it is no longer the first organizing frame. It comes after role/relationship chain, is reviewed/locked, then gets bridged into character/relationship evolution before plot beat mechanics.
- Latest checks after v4.0 mini-agent work: `npm run lint` passed with only existing warnings, `npm run build` passed, and `git diff --check` passed with existing CRLF warnings only.
- Not yet done: browser click-through dogfood of the lock-save tab flow and approved real-AI dogfood on the EP1 seed flow.

Everything below is retained as historical context only. If it conflicts with the cockpit spec, the cockpit spec wins.

## One-Line Goal

Plot Lab is a guided creative workspace where Levi scans the existing source, asks only the next useful decision question, lets the writer answer through simple selectable choices, and gradually moves toward monetization-cliffhanger and episode-sketch decisions that can be confirmed into ANW tabs.

## Current Problem We Need To Fix

The prototype is close, but the interaction model is not yet disciplined enough:

- Levi can still ask questions in formats that feel like free-text chat.
- Older assistant messages can remain actionable, which creates confusion after a decision has already been made.
- The system does not yet have a clear question budget before moving toward monetization-endpoint work.
- System-of-record saving is conceptually right, but it should happen at stage-summary confirmation, not after every ordinary assistant reply.

## Monday Principle

The writer should never wonder, "What am I supposed to do here?"

Every Levi question should offer easy selectable choices. The chat box remains available for custom instructions, but the default path is always click/select.

## Hidden Workflow

No visible stage strip for v1. The flow is enforced by Levi behavior and chat decisions, not by a heavy UI.

### Stage 1: Source Scan

Levi reads:

- Microdrama Plot 1
- Predefined Episode 1
- Source / Original Research, only as supporting context
- Characters, only if already available

Levi outputs a compact understanding:

- Core contract / promise of Episode 1
- Protagonist pressure
- Relationship pressure
- Unresolved engine that can carry the first pack

Then Levi asks one selectable decision question.

### Stage 2: Core Contract

Goal: lock what the series is primarily promising the viewer.

Example question:

> Which core hook should drive the series?

Example options:

- A) Private nurse to a dangerous man: proximity, danger, and reluctant attachment.
- B) Hidden talent underworld: her dream becomes entangled with the yakuza world.
- C) Deal with the devil: money/help arrives, but every favor creates moral debt.
- D) Romance under threat: attraction becomes leverage that other factions can exploit.

Decision count: 1 of 3.

### Stage 3: Character Goals And Motivations

Goal: ask only what matters to the chosen core contract. Do not profile the full cast.

Decision 2 should clarify the protagonist:

- What she wants right now
- What she cannot afford to lose
- Why she accepts or cannot escape the contract

Decision 3 should clarify the opposing pressure:

- Who or what makes the contract dangerous
- What pressure escalates the first pack
- What cannot be resolved before monetization

Decision count: 2 and 3 of 3.

### Stage 4: Monetization Cliffhanger

After 3 setup decisions, Levi should stop collecting context and pitch monetization-cliffhanger endpoints.

This is not the Episode 1 cliffhanger. Episode 1 is evidence. The question is:

> What is the strongest paywall endpoint the first pack can build toward?

Levi should offer 3-4 options. Each option should explain:

- What happens
- Why it is monetization-friendly
- What emotional/story question it forces the viewer to pay to resolve
- What it sets up for the next pack

### Stage 5: Middle Beats And Episode Sketches

Once a monetization endpoint is selected, Levi proposes fun and interesting events that can happen between Episode 1 and the endpoint.

These are not final plots yet. They are candidate beats.

After beats are selected, Levi creates 1-2 sentence episode sketches. These later feed final Microdrama Plot generation.

## Question Budget

Before monetization endpoint options, Levi gets exactly 3 setup decisions:

1. Core contract / series hook
2. Protagonist goal, pressure, or non-negotiable
3. Opposing pressure / danger engine

Rerolls do not count as decisions.

Custom typed answers count if they clearly answer the current decision.

If the writer says "skip" or "good enough," Levi should move forward using the strongest assumption from existing context.

## Selection Rules

### Every Levi Question Needs Choices

Levi should never ask a decision question with only prose.

Good:

```text
Which version is canon?
- A1) Polite request, hidden order: She can refuse socially, but not safely.
- A2) Paid offer: She chooses the money, then realizes the danger.
- A3) Protection trap: Staying with him is framed as the only safe option.
```

Bad:

```text
Which one do you want?
```

### Old Actions Disappear

Once a user selects an option:

- The selected answer appears as the user reply.
- The chosen Levi message stays readable.
- Its buttons disappear.
- Older Levi messages also lose their buttons.
- If the user wants to revisit an earlier decision, they do it by typing in chat.

This avoids branch confusion in v1.

### Latest Action Only

Only the latest actionable Levi message should have buttons.

This rule should apply to:

- Option cards
- Confirm/tweak choices
- Reroll choices
- Compact quick replies

## Locking Rules

Ordinary choices are chat decisions, not system-of-record writes.

System-of-record save happens only after Levi creates a stage summary and the writer confirms it.

### Stage Summary Confirm

At the end of a meaningful stage, Levi summarizes:

- What was decided
- What it unlocks next
- Destination tab if confirmed

Then Levi offers:

- Confirm
- Tweak
- Reroll / try alternate

Only Confirm opens the double-confirm modal.

## ANW Tab Routing

Confirmed artifacts route to existing ANW tabs:

- Characters -> character decisions and motivation locks
- Locations -> locked location facts
- Current Beats -> selected beats
- Episode Sketches -> 1-2 sentence episode plans
- Microdrama Plots -> expanded final plots only

Episode Sketches is for the pre-final 1-2 sentence episode plan.

Microdrama Plots is only for final plot generation after a sketch is locked.

## UI Behavior

### Chat Bubble Rendering

Levi assistant messages can render:

- Text understanding
- Choice cards for detailed story options
- Compact buttons for confirm/tweak/reroll/simple decisions

The user input box remains available below.

### Choice Cards

Use cards when the option has explanation:

- Label: A, B, C, D or A1, A2, A3
- Title: short, human-readable option
- Detail: why it matters or what it sets up

### Compact Buttons

Use compact buttons for:

- Confirm
- Tweak
- Reroll
- Continue
- Skip for now

Minimum hit target should remain easy to click.

## Prompt Requirements

Levi must:

- Ask one question at a time.
- Keep the first setup phase to 3 decisions.
- Always provide selectable options for every question.
- Avoid profiling the whole manuscript.
- Stay close to Microdrama Plot 1 and Predefined Episode 1 until the first monetization endpoint is chosen.
- Treat Episode 1 as evidence, not as the endpoint.
- Move toward monetization-cliffhanger options after the 3 setup decisions.
- Convert selected middle beats into episode sketches only after the monetization endpoint is chosen.

Levi must not:

- Ask multi-question batches.
- Ask "what do you think?" without choices.
- Save every decision immediately.
- Leave old choices clickable after a newer decision.
- Expand to full Microdrama Plots before episode sketches are confirmed.

## Implementation Notes

No migration should be needed for v1.

Recommended implementation direction:

- Keep decision state client-side inside the Plot Lab chat component.
- Track the latest actionable assistant message by history index.
- When a Plot Lab decision is selected, mark all previous actions as consumed.
- Persist only normal chat history for now.
- Continue using the existing double-confirm save flow, but trigger it only from summary-confirm states.

Likely code areas:

- `AIChatSidebar.tsx`: choice rendering, active-action gating, click behavior
- `prompts.ts`: Levi workflow and decision-budget rules
- `context-engine.ts`: source scan context and routing contract
- `PlotLabWorkspace.tsx`: copy and workspace framing only

## Monday Discussion Checklist

- Does the 3-decision setup feel enough before monetization endpoints?
- Are the 5 hidden stages the right mental model?
- What exact artifacts should be locked after Stage 2 and Stage 3?
- Should Episode Sketches be one tab entry per episode or one pack summary first?
- Should reroll preserve previous options in chat as text only, or replace the latest option set?
- How much should Levi explain why it is asking each question?

## Acceptance Criteria For Next Prototype

- User can run the flow from Episode 1 context without typing, except optional custom notes.
- Every Levi question has clickable choices.
- Only the latest Levi question is actionable.
- After 3 setup decisions, Levi pitches monetization-cliffhanger endpoint options.
- Stage summaries can be confirmed into ANW tabs with double-confirm.
- No ordinary chat reply opens the system-of-record save modal.
- Old messages stay readable but are not clickable.
- Build passes.

## Implementation Checkpoint - 2026-10-05

- Implemented latest-action-only gating in the Plot Lab chat renderer: old Levi messages stay readable, but only the newest actionable assistant message exposes choice buttons.
- Routed Stage Summary confirm clicks into Plot Lab Save Preview; ordinary choices remain chat-only and do not open the system-of-record save modal.
- Tightened Levi prompt behavior around the 3 setup decisions, monetization endpoint transition, and Stage Summary save contract.
- Local verification: `npm run lint` passed with warnings only; `npm run build` passed; `http://localhost:3000/docs` returned 200.
- Local auth: `BYPASS_AUTH` is enabled and `/api/auth/session` returns admin dev user `vikas@terra.com`.
- Local AI: `/api/ai/models` returns configured OpenAI model `gpt-5.2`, so AI is enabled at the app configuration level. No paid real-AI generation was run in this checkpoint.

## UX Correction Checkpoint - 2026-10-05

- Added `docs/plot-lab-product-contract.md` to define Plot Lab use cases, supported actions, option hygiene, consequential character discovery, monetization endpoint design, immediate E2 runway, and post-save E2-E5 sketch handoff.
- Reroll must replace the option set, not accumulate old and new options.
- Custom typed answers are first-class decisions and may merge options with extra instructions.
- Monetization and E2 options must be gated by immediate character/relationship clarity. Levi should ask about consequential pilot characters such as Ming before inventing monetization roles for them.
- Episode 2 options must be executable in one 60-90 second episode: one visible turn, one pressure shift, one ending hook.

## Levi Partner Build Checkpoint - 2026-10-05

- Reframed Levi from a decision workstation into an expert microdrama brainstorming partner: he can answer normally, challenge weak ideas, nudge the writer back to the path, and only render actions when there is a real decision.
- Added the Plot Lab Decisions canonical tab as the artifact ledger for core contract locks, character-pressure locks, monetization endpoint locks, E2 runway decisions, sketch runway handoffs, and final plot handoffs.
- Plot Lab now infers its visible phase from locked artifacts first, then chat history. A light path strip shows the current phase, next useful action, and locked-decision count.
- Levi context now includes Plot Lab Decisions, so stage recovery does not depend only on hidden client state.
- Save Preview can route stage summaries to Plot Lab Decisions; Episode Sketches remains for 1-2 sentence sketches, and Microdrama Plots remains for final expanded plots.
- Final plot expansion is now part of the planned path after locked sketches, not an early-stage shortcut.
