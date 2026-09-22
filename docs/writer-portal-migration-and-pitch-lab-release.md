# Writer Portal Migration And Pitch Lab Release Gates

Status: active release checklist after the 2026-09-21 storage incident, VM cutover, and portal migration.

## Canonical Production Portal

- Live Writer portal: `https://writer.plotpix.ai/`.
- The old Cloud Run URL is deprecated and must not be used as the canonical production URL.
- The database has been ported to VM persistent storage at `/home/plotpix/ai-native-writer/data/writer.db`.
- All production verification must happen against `writer.plotpix.ai`.

## Before Pitch Lab Is Enabled

1. Verify the portal baseline on `writer.plotpix.ai`: login, document list, open existing doc, edit/save/reload, and version/history sanity.
2. Verify runtime health from VM logs or admin health checks: DB opens from the VM path and there are no migration/startup errors.
3. Run a read-only live DB inspection before relanding schema-dependent Pitch Lab work:
   - `PRAGMA integrity_check;`
   - `__drizzle_migrations` entries for `0009_pitch_lab` and `0010_pitch_lab_reconcile`
   - existence and columns for `pitch_workspaces`, `pitch_sources`, `pitch_ideas`
   - row counts for each `pitch_*` table
4. Do not drop or mutate orphan `pitch_*` tables without explicit current-message confirmation.

## Release Gates

Pitch Lab is controlled by two flags:

- Server/API: `PITCH_LAB_ENABLED=true`
- Client navigation/page: `NEXT_PUBLIC_PITCH_LAB_ENABLED=true`

Default should be disabled until the portal and DB gates above pass. API routes are admin-only and hidden unless the server flag is on. Navigation and direct page use are hidden/blocked unless the client flag is on and the user is admin.

Recommended rollout:

1. Ship schema/API with both flags disabled.
2. Enable server flag for admin API smoke testing.
3. Enable client flag for admin-only `/pitch-lab` UI testing.
4. Verify generation, shortlist, edit current text, refine without saving first, restore, reject, and promote-to-doc.
5. Only then consider broader production visibility.

## Release Blockers

- Any document list/open/save 500.
- Any DB open, migration, or PM2 restart error.
- Unknown live `pitch_*` schema state.
- Old Cloud Run URL used as canonical production URL.
- Pitch Lab cannot be disabled without rollback.
