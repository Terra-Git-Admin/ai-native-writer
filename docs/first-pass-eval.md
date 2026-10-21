# First-generation fit evaluation

This offline evaluator compares an AI first-generation script with its accepted final export. The final is the editorial reference. The score measures how much material revision the first draft needed to reach that reference; it is not a judgment of the final, a claim that unchanged content is defective, or a measure of editor time.

## Trigger and lifecycle

An accepted export is the first evaluation trigger. The existing metadata lineage writes a `final_export` snapshot and export event at that point; the earlier `first_generation` snapshot must already exist. The export UI then requests an AI-labelled report separately, so report failure does not invalidate the export link. Opening the latest report is the other trigger. Both use stored snapshots; there is no continuous background scoring.

The in-app report endpoint is owner/admin only. It labels changed groups with a configured AI model, caps each request at 24 model calls, and stores the AI labels against the exact first/final snapshot pair in the final snapshot metadata. Reopening a completed report reuses those labels. Scores remain marked provisional pending human calibration; missing lineage, model failures, long changes, or a call-cap cutoff leave affected episode scores pending. The offline CLI remains available for detailed review and fixed-fixture trend analysis.

## Unit of comparison and score

The parser divides each script into sequence headings, visual directions, character dialogue, voice-over, and other lines. It aligns corresponding lines, including simple splits, merges, and exact moves. Reviewers label **changed aligned groups**. Case, spacing, and punctuation-only edits do not require review.

For each changed group, `material` means the edit changes story facts, beat/scene structure, character emotion or intent, spoken content or voice, visual action, or script form required for production. If material, assign one primary category. An edit can have secondary effects; use the category that best explains why the editor changed it. If several independent changes are packed into one aligned group, flag it in `rationale` for later parser refinement rather than assigning multiple categories.

| Category | Primary reason for the revision |
| --- | --- |
| `story_truth` | Plot facts, causality, continuity, stakes, revelations, or outcomes |
| `episode_shape` | Beat order, setup/payoff, pacing, entrances, exits, or scene structure |
| `character_emotion` | Motivation, emotional turn, relationship pressure, reaction, or intent |
| `dialogue_vo` | Spoken lines, voice, subtext, rhythm, exposition, or voice-over |
| `visual_storytelling` | Visible action, staging, imagery, or information conveyed visually |
| `script_form` | Production-relevant format or attribution correction |
| `other` | Material revision outside those categories; explain it in `rationale` |

Each aligned group weighs `max(first line count, final line count)`. The fit score is `100 × (1 − material group weight / all aligned group weight)`, rounded to one decimal. Category points lost are `100 × category material weight / all aligned group weight`; they approximately sum to `100 − fit` because of rounding. This is an **editorial revision burden proxy**. It intentionally does not infer that all edits were equally difficult or that a first draft matching the final is universally good.

`pending` means at least one changed group has no complete label. `provisional` means every changed group is labelled but at least one was not human reviewed. `reviewed` means every changed group was reviewed. The aggregate fit median uses reviewed episodes only. Word edit rate is a separate mechanical diagnostic: within aligned groups, word insertions/deletions/substitutions divided by first-draft words. It can exceed 100% when the final adds considerable material. Exact moves are reported separately.

## Run the saved Café pilot

From the AI Native Writer worktree:

```powershell
npm run eval:first-pass -- --pairs-json D:/codex-global/cafe-lineage-texts-20261008.json --out D:/codex-global/cafe-first-pass-pilot-NEW
```

The cached input contains E24–E31 exact first-generation/final-export pairs. Output includes `summary.md`, `episode-scores.csv`, `metrics.json`, `coverage.json`, and `review.json`. `review.json` contains script text: keep it outside Git and do not publish it. The evaluator refuses to overwrite an existing review unless it is supplied as `--labels` from that same output directory.

Review each changed group in `review.json` and set `material` (`true` or `false`), `category` (one of the names above when material; otherwise `null`), `reviewed: true`, and a short `rationale`. Then recalculate:

```powershell
npm run eval:first-pass -- --pairs-json D:/codex-global/cafe-lineage-texts-20261008.json --labels D:/codex-global/cafe-first-pass-pilot-NEW/review.json --out D:/codex-global/cafe-first-pass-pilot-NEW
```

The script IDs and aligned change IDs bind labels to the exact two texts. A changed source or alignment changes those IDs, leaving the corresponding score pending instead of silently reusing stale labels.

## Read-only database extraction

Provide a local SQLite snapshot and a manifest containing `documentId`, `exportIds`, and an ISO `cutoff`. `pairOverrides` may explicitly name a reviewed first-generation snapshot for an export event. The loader selects the latest eligible export per episode, requires an exact generation-run match by default, and reports unmatched/ambiguous rows in `coverage.json`.

```json
{
  "documentId": "DOCUMENT_ID",
  "exportIds": ["EXPORT_ID"],
  "cutoff": "2026-10-21T00:00:00Z",
  "pairOverrides": [{ "exportEventId": "EVENT_ID", "firstSnapshotId": "SNAPSHOT_ID" }]
}
```

```powershell
npm run eval:first-pass -- --db D:/path/to/local-snapshot.db --manifest D:/path/to/manifest.json --out D:/path/to/new-report
```

The command opens the database read-only. Snapshot pairing and coverage must be checked before interpreting the scores. Historical capture completeness cannot be estimated without the count of all generation attempts.

## Optional AI labelling and calibration

AI labels are provisional until a human reviews them. Paid judging is only run when a person has expressly approved that paid work and the operator supplies all of `--judge --allow-paid-ai --judge-provider google|anthropic|openai --judge-model MODEL_ID --max-calls N`. Set the corresponding provider API key in the environment. The CLI uses one named model and stops at the call cap; it does not switch models. Review files can contain customer script text and must stay local.

After saving a separate human-reviewed copy of the judge review, compare the two:

```powershell
npm run eval:first-pass:calibrate -- D:/path/to/judge-review.json D:/path/to/human-review.json
```

The calibration gate requires at least 40 human-reviewed changed groups across at least 10 episodes and at least 80% exact agreement on material status and primary category. Café E24–E31 alone has eight episodes, so it cannot pass the ten-episode gate. The report also gives material-only agreement and specific disagreement IDs. Review disagreement clusters and revise the rubric/version before accepting unattended category summaries.

## Measuring model improvement

Freeze a set of source packets and accepted final references. Generate new first drafts on the same packets, record model/prompt version and generation run, and evaluate each candidate against the *same* final snapshot and rubric. A trend comparison accepts only human-reviewed paired scores with different first-generation snapshot IDs:

```powershell
npm run eval:first-pass:trend -- D:/path/to/baseline/metrics.json D:/path/to/candidate/metrics.json
```

Track paired median fit change, number of improved/declined episodes, category point changes, word edit rate, and coverage. Treat changes as directional until enough repeated fixed-fixture runs establish run-to-run variance. On-demand reports still need reliable first-generation and final-export snapshots plus attempt counts for coverage; the evaluator cannot reconstruct generations that were never captured.
