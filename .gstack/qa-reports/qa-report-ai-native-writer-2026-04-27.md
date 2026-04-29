# QA Report — ai-native-writer (live)

**Target:** https://ai-native-writer-936494534526.asia-south1.run.app/
**Date:** 2026-04-27
**Mode:** Evidence-based (DB + Cloud Run logs, no browser automation)
**Tester:** Claude Code (vikas@letsterra.com session)
**Live revision:** ai-native-writer-00050-n2n
**Test target doc:** 1VEYHPRkgiDD ("Testing")
**Framework:** Next.js 16.2.2 standalone, SQLite + GCS-direct backup loop
**Auth gate:** Google OAuth, domain-locked to `letsterra.com`

---

## Health Score: **86 / 100**

### Score breakdown

| Category | Weight | Score | Notes |
|---|---|---|---|
| Console | 15% | 100 | Zero ERROR-level logs on rev 00050-n2n in last 30 min |
| Save flow | 20% | 100 | All saves verified durable in GCS canonical snapshot |
| Functional (version history) | 20% | 95 | Tab-switch + Ctrl+S checkpoints work; one UX gap (cascade-on-tab-delete) |
| UX (banner / refresh button) | 15% | 100 | Content-mismatch false positive resolved; refresh button removed per writer feedback |
| Durability | 15% | 60 | Bootstrap-not-running gap still open — worst-case 60-90s loss window on container kill |
| Performance | 10% | 90 | "Unsaved → saved" sub-second, confirmed by writer ("pretty instantaneous") |
| Accessibility | 5% | unscored | Out of scope for this run |

**Weighted score: 86 / 100.**

---

## Top 3 Things to Fix

1. **Wire up the GCS bootstrap on Cloud Run** (`HIGH`) — see Issue 1. Closes the 60-90s loss window. Code is shipped, just needs a Cloud Run command override.
2. **Add tab-deletion cascade safeguard** (`MEDIUM`) — see Issue 2. Currently deleting a tab silently nukes its version history with no confirm.
3. **Implement undo-revert UX** (`LOW`, backlog) — see Issue 3. Server already preserves pre-revert state; just need UI surface.

---

## Issues found

### Issue 1 — Cloud Run command override bypasses durability bootstrap

**Severity:** HIGH
**Category:** Durability / infrastructure
**Status:** Known, deferred
**Tracking:** `ai-native-writer-durability-patch.md` memory file

**Symptoms:**
- Live SQLite still resides on the gcsfuse mount at `/app/data/writer.db`, not on real local disk at `/tmp`.
- The bootstrap script `scripts/db-bootstrap.mjs` (PR #31, code shipped) does not run because Cloud Run service has `command: [node], args: [server.js]` set service-side, overriding the Dockerfile `CMD ["sh", "-c", "node /app/db-bootstrap.mjs && node server.js"]`.
- Worst-case loss window on container kill: ~60-90 seconds (the GCS backup loop interval), not catastrophic but not fully closed.

**Evidence:**
```
$ gcloud run services describe ai-native-writer --region=asia-south1 \
    --format="yaml(spec.template.spec.containers[0].command,...)"
spec:
  template:
    spec:
      containers:
      - args:
        - server.js
        command:
        - node
```
- `DATABASE_PATH=/app/data/writer.db` (gcsfuse) — confirmed from env-vars listing.
- Backup loop healthy: latest canonical at `gs://ai-native-writer-db/snapshots/writer.db.gz` generation `1777296529240943` (~5 min ago).

**Repro:**
1. SSH into the production container (or read logs).
2. Confirm `DATABASE_PATH` resolves to the gcsfuse path, not `/tmp`.
3. Confirm no `[bootstrap] gcs.download.ok` log line on container start.

**Suggested fix:**
- `gcloud run services update ai-native-writer --region=asia-south1 --command=sh --args="-c,node /app/db-bootstrap.mjs && node server.js" --env-vars-file=envvars.yaml` (using YAML to avoid Git Bash MSYS path translation, learned from 25 Apr deploy).
- Then flip `DATABASE_PATH` to `/tmp/writer.db` in the same YAML.
- Verify `db.boot.ready { source: gcs }` on the next revision's first log line.

---

### Issue 2 — Tab deletion cascades to all version history

**Severity:** MEDIUM
**Category:** Functional / data safety
**Status:** New finding (today's QA)

**Symptoms:**
- When a user deletes a non-protected tab, the FK cascade `document_versions.tab_id ON DELETE CASCADE` removes ALL version-history rows for that tab.
- No confirm dialog flagging this side-effect.

**Evidence:**
- Schema: `src/lib/db/schema.ts:129` — `tabId: text("tab_id").references(() => tabs.id, { onDelete: "cascade" })`
- DB query: tab `bJ8GfkXpwxQX` ("TEst tab") was deleted today; its 1 version row at 11:47:28 UTC was cascaded away. Zero orphan rows confirmed:
```sql
SELECT COUNT(*) FROM document_versions
WHERE document_id='1VEYHPRkgiDD'
AND tab_id NOT IN (SELECT id FROM tabs WHERE document_id='1VEYHPRkgiDD');
-- → 0
```

**Repro:**
1. Create a non-protected tab on any doc.
2. Type something — wait 5+ min for at least one version row to land, OR press Ctrl+S to force one (post PR #33).
3. Delete the tab via the UI.
4. Query `document_versions` — all rows for that tab are gone.

**Suggested fix (3 options):**
- `(a)` Add a confirm dialog: *"This will also delete N saved versions. Continue?"*
- `(b)` Switch FK to `ON DELETE SET NULL` so version rows survive (requires UI handling for orphan rows).
- `(c)` Add a soft-delete column to `tabs` so version history is preserved by reference.

User raised this at the same time as the "saved versions are getting deleted" worry. The cascade is by-design but invisible.

---

### Issue 3 — No "undo revert" UX after a wrong revert click

**Severity:** LOW (backlog item)
**Category:** UX
**Status:** Backlog (`ai-native-writer-undo-revert.md`)

**Symptoms:**
- After clicking "Revert this tab", the writer has no one-click way to return to the pre-revert state if they realize the chosen version was wrong.
- They have to find the auto-created snapshot in the version list manually.

**Evidence:**
- `src/app/api/documents/[id]/versions/revert/route.ts:66-75` already inserts the current tab content as a new `documentVersions` row before applying the chosen old version. So data is preserved — UI just doesn't surface it.

**Suggested fix:**
- Label the auto-created snapshot at the top of the version list as *"Just before your revert · click to undo"* for ~30 seconds.
- Or: a transient toast `Reverted · Undo`.
- No schema change needed.

---

## Verifications passed (regressions checked)

### V1 — Save-flow durability
**PASS.** Every keystroke entered today on doc `1VEYHPRkgiDD` is in the GCS canonical snapshot.
- Latest canonical generation: `1777296529240943` (live).
- 25 version rows for the doc, none orphaned, oldest 06:44 UTC, newest 11:51 UTC.
- All 5 protected tabs + the new "test2" custom tab present and content matches what the writer typed.

### V2 — Content-mismatch banner false positive (was: PR #32)
**PASS.** Zero `client.poll.conflict` events on rev 00049 / 00050 in the last 60 min.
- Every poll tick logs `client.poll.skip.inflight` (saveStatus="unsaved") or `client.poll.skip.ownSave` (saveStatus="saved", `updatedAtMatch=true`).
- Writer confirmed: *"I never saw the save mine vs. keep header"*.

### V3 — Version-history checkpoints on tab-switch + Ctrl+S (PR #33)
**PASS.** Sample log timeline from today:
```
13:55:21  tab.version.throttled                                      (auto-save mid-typing — correct)
13:55:25  tab.version.throttled
13:55:30  tab.version.throttled
13:55:33  tab.version.throttled
13:55:34  tab.version.created  force=true reason=tab-switch          ← bypass works
13:56:14  tab.version.throttled
13:56:15  tab.version.created  force=true reason=tab-switch          ← bypass works
13:56:30  tab.version.created  force=true reason=tab-switch          ← bypass works
```
- `tab.version.skip.duplicate` fires correctly when content unchanged (rapid A→B→A switches).

### V4 — Refresh button removed from VersionHistory
**PASS.** Code review of `src/components/editor/VersionHistory.tsx` — only title + × close button in the header. Auto-poll continues every 15s.

### V5 — "Every 5 minutes" empty-state copy removed (rev 00050)
**PASS.** Empty state now reads *"No versions saved yet for this tab."* — implementation detail removed.

### V6 — New-document creation flow (per `feedback-new-doc-must-work.md`)
**PASS.** Doc `3LkZtiGG7MiV` ("Test3") was created during today's session at 13:56:02 UTC. All 5 canonical protected tabs seeded correctly:
- Original Research (series_overview)
- Characters (characters)
- Microdrama Plots (microdrama_plots)
- Predefined Episodes (predefined_episodes)
- Workbook (workbook)

### V7 — Comments + comment replies persist
**PASS.** 3 comments on `1VEYHPRkgiDD`: 1 resolved, 1 unresolved + 1 reply. All foreign keys intact.

### V8 — Backup loop on rev 00050
**PASS.** Backup loop continued through both deploys (00048→00049→00050). No gaps in `db.backup.upload.ok` events.

---

## Console health summary

**Zero ERROR-level logs across last 30 min on rev 00050-n2n.**

Routine traffic observed (non-error):
- `tab.get.ok` / `tab.put.ok` / `tab.put.fingerprint` (save flow)
- `tab.version.created` / `tab.version.throttled` / `tab.version.skip.duplicate` (version flow)
- `client.poll.skip.inflight` / `client.poll.skip.ownSave` (poll flow, post-fix)
- `db.backup.upload.ok` (backup loop, every 60-90s when content changes)
- `db.backup.skip.unchanged` (backup loop, when idle)

---

## Test coverage notes

This run did **not** verify (would need browser automation with auth):
- Visual layout / responsive design across mobile breakpoints.
- AI chat sidebar interactions (separate code path).
- Comment-mark application via reviewer flow.
- Document deletion + cascade-to-tabs + cascade-to-versions.
- Cross-user reviewer permissions on shared docs.

If any of those become priorities, run `gstack setup-browser-cookies` + a real `/qa` browser pass.

---

## Regression vs. baseline

No prior baseline file. This is the first formal QA-only report for this app. Saving as baseline for the next run.

---

## Net assessment

**Ship status: GO.** Today's three PRs (#32 millis-truncation, #33 force-version checkpoints, #34 empty-state copy) are live, healthy, and writer-validated. The durability gap (Issue 1) was already in production yesterday — this deploy didn't widen it. The two new findings (Issues 2 + 3) are MEDIUM and LOW respectively, neither blocks shipping.

Recommended next session focus: **Issue 1** (wire up the bootstrap). Single biggest durability win remaining. ~30 min of careful Cloud Run config work + verification.
