# AI Native Writer — Next Session Handoff

_Written 2026-07-15 (end of the incident session). Open this in a project-rooted terminal (`D:\plotpix\ai-native-writer`), not from `C:\Users\vikas`._

## TL;DR — where we are

Two **separate** problems. Don't conflate them.

| # | Problem | Cause | Fix | Status |
|---|---------|-------|-----|--------|
| 1 | Documents slow to open (~3–5s) | DB bloat — but **NOT** version count (prune deleted 0) | Find where the 89 MB actually lives, then trim that | **Open — root cause not yet located** |
| 2 | "Rate exceeded" 429s / app won't load | A stuck browser loop hammered the single server → jammed backups → 91 MB WAL → CPU pegged → app-wide 429 | One restart of the Cloud Run instance | **Loop killed ✅ — restart still pending (deferred to end of work hours)** |

**Restart tonight fixes #2 (errors), NOT #1 (slowness). They are different jobs.**

---

## First thing to do next session: VERIFY current state

The user reports it "seems faster" — confirm with logs before trusting it. Run these (read-only):

### 1. Is the server still choking? (Issue 2 check)
```
gcloud run services logs read ai-native-writer --region asia-south1 --limit 100
```
Look for:
- `dbSize` / `walSize` — WAL should be small (few MB), not ~91 MB. If WAL is still huge → server never recovered, restart still needed.
- `db.backup.snapshot.ok {bytes, durationMs}` — `bytes` should be > 0 and `durationMs` a second or two, NOT `bytes:0 durationMs:25001` (that was the failing thrash).
- Any lingering `429` / `tick_wait_timeout` / `prune-versions` hits — should be gone.

### 2. Is the cloud safety copy healthy? (read-only, do this regardless)
```
gsutil ls -l gs://ai-native-writer-db/snapshots/writer.db.gz
gsutil ls -l gs://ai-native-writer-db/snapshots/history/ | tail -5
```
Confirm the canonical `writer.db.gz` has a sane recent size (not 0 bytes / not overwritten by a failed backup). `history/` gives a restore point if canonical is bad.

### 3. Is open latency actually better?
Open a doc on the live app, watch console/network for the `/content` and `/doc` request timings. Compare against the ~3.5–4.7s baseline noted in `PERF-PHASE1.md`.

---

## Issue 2 — restart (deferred to end of work hours)

Only if step 1 above shows the server is still jammed (big WAL, 0-byte backups, ongoing 429s). Needs **explicit yes** and a **project-rooted session**.

```
gcloud run services update ai-native-writer --region asia-south1 --update-env-vars _RESTART=$(date +%s)
```
- A fresh instance boots with an empty WAL and restores the DB from the good GCS snapshot.
- Brief drop for active users during the swap — that's why it's off-peak.
- Data-loss caveat: on SIGTERM the old instance runs a final backup (`shutdownBackup()` in `persistence.ts:463`). Confirm GCS health (step 2) before restarting so we know the restore point holds.
- After restart: re-run step 1 to confirm WAL is small and backups succeed.

---

## Issue 1 — the real performance problem (the original task)

**What we learned today:** the "too many versions" theory was WRONG. The prune route ran and returned `{ok:true, pairs:332, totalDeleted:0}` — nothing to delete. Version *count* is not the bloat lever.

**So the 89 MB lives somewhere else.** Candidates:
- Legacy `document_versions` rows with `tabId IS NULL` — the prune route **skips these** (`route.ts:40 if (!p.tabId) continue;`). Could be large old snapshots.
- A different table entirely (e.g. `ai_chat_history`, or fat `content` blobs in `documents`/`tabs`).

**Next step = measure, don't guess.** Get an offline copy of the DB (download the GCS snapshot, gunzip) and run per-table size + row-count queries. Do NOT run heavy queries against the live single instance — that's what caused Issue 2.

Rough plan:
1. `gsutil cp gs://ai-native-writer-db/snapshots/writer.db.gz .` → `gunzip` → open with a local sqlite tool.
2. Per-table page/byte usage — e.g. `SELECT name FROM dbstat` / `dbstat` virtual table, or `SELECT SUM(LENGTH(content)) FROM document_versions WHERE tab_id IS NULL;` etc. to see where bytes concentrate.
3. Count null-tabId version rows: `SELECT COUNT(*), SUM(LENGTH(content)) FROM document_versions WHERE tab_id IS NULL;`
4. Decide the real trim (likely: delete/aggregate legacy null-tabId snapshots) based on what the numbers show.

**Cleanup:** once the true bloat is located and handled, delete the TEMPORARY route `src/app/api/admin/prune-versions/route.ts` — it did its job (0 to delete) and shouldn't linger.

---

## Guardrails (from CLAUDE.md — do not forget)
- `better-sqlite3` is **synchronous, main-thread**. Any heavy DB op (DELETE, VACUUM, backup, big SELECT) on the live instance blocks ALL requests → 429s. Do diagnosis on an **offline copy**.
- Explicit "yes" in the current message required before any deploy / service update / restart / destructive op.
- Feature-branch git workflow; `npm run build` locally before any push.

## Source-of-truth docs
- `PERF-PHASE1.md` — full Phase 1 detail + baselines.
- `BACKLOG.md` — global backlog.
- Memory `MEMORY.md` — session notes.
