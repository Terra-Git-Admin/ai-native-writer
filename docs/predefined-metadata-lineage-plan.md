# Predefined Episode Metadata Lineage Plan

Date: 2026-10-01
Status: Monday execution candidate, capture-only V1

## Objective

Create ANW's first internal metadata system for Predefined Episodes so we can compare what AI initially generated against what eventually gets exported to Comics Dash.

V1 is not a generation-quality fix. It is the data foundation for later prompt and workflow improvement.

## Current State

ANW does not have structured episode metadata today.

Existing raw sources:

- `ai_jobs`: durable workbook action outputs and context snapshots.
- `ai_chat_history`: AI Assistant messages.
- `document_versions`: saved tab snapshots.
- `handoff_exports`: final export JSON snapshots.
- client/server logs: hashes, sizes, and lifecycle events.

Missing today:

- Structured Predefined episode metadata.
- First-generation artifact records.
- Export-time final artifact records.
- A durable link from AI output to writer-edited final export.
- Stored metadata deltas.

## Monday V1 Scope

Build the smallest complete capture layer:

1. Predefined metadata extractor.
2. `content_artifacts` table.
3. Capture Predefined Lab completed draft artifacts.
4. Capture export snapshot artifacts from the exact saved content used by export.
5. Fixture tests for parsing and artifact creation.

V1 should not create `content_deltas` yet. Deltas should be computed later once artifact shape is trusted.

## Metadata To Capture

Artifact identity:

- `documentId`
- `tabId`
- `artifactType`: `predefined_episode`
- `sourceSurface`: `predefined_lab` or `export_snapshot`
- `sourceStage`: `beats`, `dialogue_design`, `draft`, `final_export`
- `sourceId`: turn id, export id, or related row id when available
- `episodeNumber`
- `episodeTitle`
- `contentHash`
- `contentLength`
- `createdBy`
- `createdAt`

Episode metadata:

- Episode number and title.
- Sequence count.
- Sequence headers: sequence number, location, time of day, cast.
- Beat list with ordered index, sequence id, beat type, speaker, normalized text hash, tone tag.
- Beat counts: visual, dialogue, V.O., unknown.
- Dialogue line count.
- Dialogue line count by speaker.
- Speaker list.
- Location list.
- Cast movement across sequences.
- Location movement across sequences.
- Tone-tag coverage.
- Quote coverage.
- V.O. presence and count.
- Silence beat presence.
- First beat type and final beat type.

## Parser Inputs

The extractor must support both formats:

Canonical export/import format:

```text
[H3] Episode N: Title
[P] Seq 1 - Location | Time | Cast
[UL] (Visual: ...)
[UL] CHARACTER: "Line." [tone]
```

Predefined Lab readable draft format:

```text
Episode N

Seq 1 - Location | time | characters
(Visual: ...)
CHARACTER: "Line." [tone]
CHARACTER (V.O.): interior thought. [tone]
```

## Proposed Data Flow

```text
Predefined Lab draft complete
        |
        v
extractPredefinedMetadata(text)
        |
        v
content_artifacts(sourceSurface=predefined_lab, sourceStage=draft)

Writer edits/saves Predefined Episodes tab
        |
        v
Generate export link
        |
        v
buildExport() selects exact saved episode range
        |
        v
extractPredefinedMetadata(exported episode text)
        |
        v
content_artifacts(sourceSurface=export_snapshot, sourceStage=final_export, sourceId=exportId)
```

## Deferred Scope

- `content_deltas` table.
- AI Assistant capture.
- Durable `next_reference_episode` job capture.
- Plot metadata capture.
- Admin dashboard or report UI.
- LLM-based quality scoring.
- Automatic generation improvement.

These are deliberately deferred so Monday can establish the metadata shape without overbuilding lineage analysis too early.

## Audit Corrections To Preserve

- "Earliest matching AI draft" is not well-defined yet. Do not hardcode that rule in V1.
- Store artifacts first; compute comparisons later.
- Keep export JSON unchanged. Metadata stays internal to ANW.
- The export lock point is `POST /api/documents/[id]/export`, because it packages the exact last-saved `predefined_episodes` snapshot.
- The implementation should remain boring: deterministic parser, DB rows, fixture tests.

## Acceptance Criteria

- A Predefined Lab completed draft can be captured as a `content_artifacts` row.
- Generating an export link creates `content_artifacts` rows for selected exported episodes.
- Export response and public export JSON shape remain unchanged.
- Parser fixtures cover canonical and Predefined Lab formats.
- Malformed or empty episode text fails gracefully and does not break export.
- `npm run build` passes before release prep.

## Monday Entry Point

Start from the clean latest ANW worktree:

```text
D:\codex-global\anw-live-clean
```

Current HEAD at planning time:

```text
5e9149e Lock Pitch Lab inputs while generating (#140)
```

Before coding, re-check:

```text
git status -sb
git log --oneline -5
```

No push, deploy, production migration, or real AI generation without explicit current-message approval.
