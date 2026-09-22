# Deploy Runbook

Protocol for deploying AI Native Writer after the 2026-09-21 storage incident, VM cutover, and portal migration.

## Current Production Facts

- Canonical live URL: `https://writer.plotpix.ai/`.
- The old Cloud Run URL is deprecated and must not be used as the production portal.
- Production runs on the Linux VM behind Cloudflare Tunnel; PM2 service `ai-native-writer` listens on port 3004.
- Production SQLite DB path: `/home/plotpix/ai-native-writer/data/writer.db`.
- Pushes to `main` trigger the VM webhook deploy. Push/merge/restart still require explicit current-message confirmation.
- Pitch Lab remains gated until live DB schema state is verified.

## Pre-Deploy Checklist

1. Build the release branch from latest `origin/main`.
2. Run local checks: focused Pitch Lab ESLint, full build, and full lint when practical. Document unrelated lint failures.
3. For Pitch Lab schema work, inspect the VM SQLite DB read-only before merge: `PRAGMA integrity_check`, `__drizzle_migrations`, `.schema pitch_*`, and row counts.
4. Keep `PITCH_LAB_ENABLED` and `NEXT_PUBLIC_PITCH_LAB_ENABLED` disabled unless this deploy is explicitly approved as a Pitch Lab enablement step.
5. Confirm normal Writer portal behavior on `https://writer.plotpix.ai/` before and after deploy: login, document list, open existing doc, edit/save/reload.

## Post-Deploy Verification

1. `https://writer.plotpix.ai/` loads.
2. Login succeeds.
3. Document list loads.
4. Existing document opens.
5. A small edit saves and survives reload.
6. Version/history behavior looks sane.
7. Logs show no DB open, migration, or PM2 restart errors.

## Pitch Lab Release Checklist

Use `docs/writer-portal-migration-and-pitch-lab-release.md` before enabling Pitch Lab. Required checks:

1. Read-only VM DB inspection for `0009_pitch_lab`, `0010_pitch_lab_reconcile`, and `pitch_*` tables.
2. Confirm `0010_pitch_lab_reconcile` is safe for the observed live DB state.
3. Enable server flag only after schema health is known.
4. Enable client flag only after admin API smoke tests pass.
5. Smoke test generate, shortlist, edit current text, refine without saving first, restore, reject, and promote-to-doc.

## Rollback / Disable Strategy

- Prefer disabling Pitch Lab flags before rolling back unrelated Writer changes.
- If document save/open is affected, treat it as a production incident and disable Pitch Lab immediately while investigating.
- Do not perform destructive DB cleanup during rollback without explicit current-message confirmation.
