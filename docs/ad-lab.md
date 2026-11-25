# Ad Lab MVP

Ad Lab lives inside each Series. The home page remains Series-first and every Series receives a protected **Ads** tab immediately after **Predefined Episodes**.

## Writer flow

1. Open a Series and choose **Labs → Ad Lab**.
2. Enter an **Ad name** and a freeform brief. The brief must describe any existing footage available for B and D.
3. Choose **Generate Draft**. Ad Lab moves directly from the inputs to a complete A–B–C–D draft.
4. Revise through the feedback composer. Each response becomes the latest version while earlier versions remain available in a collapsed history for the current ad.
5. Choose **Save to Ads**. The latest valid draft is appended as a new H3 entry in the Series Ads tab.
6. Choose **New Ad** at any time to clear the current Ad Lab session. Unsaved work requires confirmation; saved Ads content is never removed.
7. Edit saved ads directly in the normal Writer editor.
8. Choose **Export → Export Ads** to create the same four-hour handoff link used by the existing Series export.

## A–B–C–D contract

- A — New clip: establishes the advertising hook.
- B — Existing footage: supplies authentic evidence from a writer-described Series moment.
- C — New clip: develops or reframes the advertising idea.
- D — Existing footage: completes the sell using a writer-described payoff, reveal, or CTA moment.

Every section requires a Visual. B and D also require Source Footage. Dialogue, V.O., On-screen Text, and Writer Notes are optional and may be used in any section. The pipeline never invents footage identifiers or timecodes.

Within that fixed contract, the draft writer may use creative devices distilled from approved samples: listicle/reveal, cast reaction or behind-the-scenes, creator tutorial/demo, actor or character skit, screenlife/text-message, and trailer-style escalation. The device shapes the execution but never changes the A–B–C–D section order or appears as process commentary in the saved ad.

Local sample mode supports the complete build, review, save, edit, and export flow without calling a paid AI provider.

## Rollout

Production rollout remains behind flags:

```env
AD_LAB_ENABLED=true
NEXT_PUBLIC_AD_LAB_ENABLED=true
```

Local development enables Ad Lab by default and opens it in **Local sample (no AI)** mode.

Categories, variants, testing relationships, automatic footage discovery, clip IDs, timecodes, and individual-ad export are intentionally deferred.
