# Plot Lab V2 persistence design

Status: implemented locally and validated against a disposable SQLite database. The migration has not been applied to the Writer database or any production environment.

The migration will be additive. Existing Stage 1 code continues to use its current browser state and existing tables. No current row requires a backfill for V2 to remain disabled or for Stage 1 to operate.

## New tables

### `plot_lab_sessions`

Stores one durable workflow aggregate per session. JSON columns hold immutable source/reference packets and versioned role settings; searchable workflow identity and concurrency fields remain scalar columns.

Required scalar fields: `id`, `document_id`, `created_by`, `status`, `phase`, `revision`, `orientation`, `seed`, `latest_output_version`, `active_job_id`, `pending_sync_action_id`, `failed_stage`, `training_pack_version`, `created_at`, `updated_at`, `archived_at`.

Required JSON text fields: `source_snapshot_json`, `source_hashes_json`, `references_json`, `interview_checkpoint_json`, `retcons_json`, `prompt_versions_json`, `model_assignments_json`.

Indexes and constraints:

- foreign keys to document/user; document deletion cascades, user deletion is restricted
- partial unique index on `document_id WHERE status = 'active'`
- index on `(document_id, status, updated_at)`
- non-negative `revision`

### `plot_lab_actions`

Global idempotency ledger for every mutation, including Restart and actions that create no visible message.

Fields: `id`, globally unique `action_id`, `document_id`, `session_id`, `created_by`, `request_hash`, `action_kind`, `base_revision`, `status`, `request_json`, `response_json`, `job_id`, `created_at`, `completed_at`.

The first lookup is by `action_id`, before resolving the document's current session. The stored user/document scope and request hash are then compared. Same scope/hash replays the recorded result; mismatched scope or hash returns a conflict without revealing the stored payload.

### `plot_lab_messages`

Canonical visible and audit message history.

Fields: `id`, `session_id`, `sequence`, `role`, `kind`, `content`, `payload_json`, `action_id`, `parent_message_id`, `dependency_ids_json`, `replay_scope`, `superseded_at`, `created_at`.

Constraints/indexes: unique `(session_id, sequence)`, indexed `(session_id, sequence)`, and indexes on parent/action IDs. Answer editing marks only the transitive derived descendants as superseded; session-scope context survives replay.

### `plot_lab_proposals`

Server-minted post-generation mutation proposals.

Fields: `id`, `session_id`, `source_message_id`, `base_output_version`, `instruction`, `target_units_json`, `downstream_units_json`, `explanation`, `status`, `confirmed_choice`, `created_at`, `resolved_at`.

A confirmation succeeds only while `base_output_version` is the current output version. Model-provided IDs or authoritative unit scopes are never persisted.

### `plot_lab_outputs`

Immutable batch versions and non-current unit candidates.

Fields: `id`, `session_id`, `version`, `parent_version`, `job_id`, `proposal_id`, `status`, `mutation_kind`, `batch_json`, `degraded_text`, `created_at`, `superseded_at`.

Constraints/indexes: unique `(session_id, version)` and partial unique `(session_id) WHERE status = 'current'`. A candidate with downstream impact remains non-current until the writer resolves it.

### `plot_lab_feedback`

Human-gated feedback tied to exact lineage.

Fields: `id`, `session_id`, `message_id`, `output_version`, `unit_number`, `rating`, `note`, `prompt_versions_json`, `model_assignments_json`, `training_pack_version`, `created_by`, `created_at`, `updated_at`.

Feedback has no automatic prompt, routing, or training side effect.

## `ai_jobs` additive extension

Nullable fields for existing jobs:

- `plot_lab_session_id`
- `concurrency_key`
- `session_revision`
- `input_snapshot_json`
- `current_stage`
- `stage_checkpoint_json`
- `stage_attempts_json`

Add a partial unique index on `concurrency_key WHERE status IN ('pending', 'running')`. Existing Writer jobs receive a stable job-class concurrency key when they are created; existing stored rows may remain null. Plot Lab uses `plot_lab:<sessionId>`, so it does not block unrelated Writer job classes.

## Atomic transaction boundaries

1. **Start:** verify document ownership/orientation and the expected active-session revision, ledger the action, then move intake to interview.
2. **Reserve synchronous turn:** ledger action, persist writer message, set `pending_sync_action_id`, and compare-and-swap the session revision.
3. **Finalize/fail synchronous turn:** verify reservation and revision, persist Levi result or visible failure, clear reservation, and advance revision.
4. **Queue generation:** verify source hashes and current output, insert job/input envelope, bind `active_job_id`, and advance revision.
5. **Stage checkpoint:** compare job status/stage/attempt plus active session/revision/job binding before committing.
6. **Output commit:** insert immutable output and message, change current-output identity atomically, clear active job, and advance revision.
7. **Restart:** globally replay-check the action, cancel/invalidate current work, archive the old session, and create the replacement intake session in one transaction.

## Migration and rollback choreography

1. Generate one additive Drizzle migration after explicit approval.
2. Validate it against a copied/local SQLite database, including foreign keys and partial indexes.
3. Run old-code compatibility checks against the migrated database.
4. Deploy code with the V2 server flag disabled.
5. Apply the approved production migration as a separately confirmed operation.
6. Enable only for admins after production migration verification.
7. Roll back behavior by disabling the V2 flag; the additive tables/nullable columns can remain in place.

No destructive down migration is part of the pilot rollback.

## Local validation completed

- `0015_plot_lab_v2_persistence.sql` contains only the additive V2 delta. Drizzle initially proposed recreating older hand-written schema objects because their snapshots were incomplete; those unrelated statements were removed before testing.
- The complete `0000` through `0014` history was applied to a disposable database, a legacy Writer job was inserted, and then `0015` was applied.
- The legacy job survived unchanged and all seven new nullable `ai_jobs` columns were present.
- Foreign-key and integrity checks passed.
- Partial uniqueness was exercised for active sessions, active concurrency keys, and current outputs.
- The revision check rejected negative revisions.
- The disposable database was removed after the test. The existing local `data/writer.db` was never opened.
