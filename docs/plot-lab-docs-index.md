# Plot Lab Docs Index

Date: 2026-10-07
Status: Navigation note for Plot Lab docs

## Read This First

`docs/plot-lab-levi-cockpit-spec.md` is the only current source of truth for Plot Lab V1. Use it for product behavior, prompt architecture, state flow, UI/UX, debug panel, locking, reroll, feedback, and acceptance tests.

## Current Docs

| Doc | Status | Use |
|---|---|---|
| `docs/plot-lab-levi-cockpit-spec.md` | Canonical | Start here for all Plot Lab work. |
| `docs/plot-lab-docs-index.md` | Current | Explains which docs still matter. |

## Archived Background

| Doc | Status | Why Keep It |
|---|---|---|
| `docs/plot-lab-product-contract.md` | Archived | Earlier product framing and use-case history. Not controlling. |
| `docs/plot-lab-levi-prompt-plan.md` | Archived | Earlier prompt diagnosis and paywall-first thinking. Not controlling. |
| `docs/plot-lab-monday-planning.md` | Archived scratchpad | Old planning doc from the Monday pass. The name is historical; it is not a weekly planning process or current implementation contract. |

## What Changed

The older docs were written while Plot Lab was still moving from a prototype chat into a state-guided creative workspace. They contain useful historical reasoning, but their older assumptions no longer govern the product.

The current architecture is:

- one visible Levi chat orchestrator
- controller-owned state, phase movement, question caps, utility controls, and save behavior
- focused mini-agents for source/lock reading, character analysis, paywall, premise bridge, runway, and continuity audit
- `Plot Lab Decisions` as the editable lock ledger
- no inline story options in chat prose
- no visible workflow dashboard beyond the bare minimum admin/debug panel

Next implementation start:

- Read the cockpit spec `Next Implementation Plan` first.
- Implement the v4.1 interaction/state fixes from the 2026-10-07 dogfood: option-only reroll, type-your-own-answer, mandatory lock-review controls, question-vector planning, source-grounding audit, and the post-monetization one-way gate.
- The post-EP1 universe work is now part of Stage 1 quality: Levi should use it to ask open-ended story-world/pressure questions through monetization lock, without entering Stage 2 beats.

## Practical Rule

If a historical doc conflicts with the cockpit spec, the cockpit spec wins.
