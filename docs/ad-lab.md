# Ad Lab MVP

Ad Lab lives inside each Series. The home page remains Series-first and every Series receives a protected **Ads** tab immediately after **Predefined Episodes**.

## Writer flow

1. Open a Series and choose **Labs → Ad Lab**.
2. Enter an **Ad name** and a freeform brief. The brief must describe any existing footage available for B and D.
3. Run the pipeline: **Inputs → A–B–C–D Structure → Communication Design → Draft**. As in Predefined Lab, writers can review each stage or select **Auto-run to Draft**.
4. Review, edit, revise, or run a dialogue pass. Generated work remains in the Lab.
5. Choose **Save to Ads**. The latest valid draft is appended as a new H3 entry in the Series Ads tab.
6. Edit saved ads directly in the normal Writer editor.
7. Choose **Export → Export Ads** to create the same four-hour handoff link used by the existing Series export.

## A–B–C–D contract

- A — New clip: establishes the advertising hook.
- B — Existing footage: supplies authentic evidence from a writer-described Series moment.
- C — New clip: develops or reframes the advertising idea.
- D — Existing footage: completes the sell using a writer-described payoff, reveal, or CTA moment.

Every section requires a Visual. B and D also require Source Footage. Dialogue, V.O., On-screen Text, and Writer Notes are optional and may be used in any section. The pipeline never invents footage identifiers or timecodes.

Local sample mode supports the complete build, review, save, edit, and export flow without calling a paid AI provider.

## Rollout

Production rollout remains behind flags:

```env
AD_LAB_ENABLED=true
NEXT_PUBLIC_AD_LAB_ENABLED=true
```

Local development enables Ad Lab by default and opens it in **Local sample (no AI)** mode.

Categories, variants, testing relationships, automatic footage discovery, clip IDs, timecodes, and individual-ad export are intentionally deferred.
