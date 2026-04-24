# Deploy runbook

Protocol for deploying AI Native Writer to Cloud Run safely, while the
storage layer is still SQLite-on-gcsfuse. Read this before every deploy.

## Why this runbook exists

gcsfuse (the Cloud Storage volume mount) buffers writes in the container
before uploading them to Cloud Storage. When Cloud Run replaces the old
container with a new one, any writes still sitting in the buffer are lost.
On 24-Apr-2026 a writer lost ~90 min of work this way. The durability
patch (PR with `db.open` / `db.checkpoint.tick` / `db.shutdown.*` logs,
plus `synchronous=FULL` and a 60-sec periodic checkpoint) narrows the
window but does not eliminate it.

The only way to make a deploy fully safe, while still on this storage
architecture, is to coordinate with writers so there is no active work in
the container buffer at the moment of cutover.

## Pre-deploy checklist

1. **Announce**: post in the writers' channel (Slack / WhatsApp / wherever
   the team coordinates):
   > "Deploying ai-native-writer in 5 minutes. Please SAVE YOUR WORK and
   > CLOSE THE EDITOR TAB in your browser. I'll post again when it's safe
   > to resume."

   Wait 5 minutes to give anyone mid-edit time to land.

2. **Wait for all-clear**: at least one writer per active doc confirms
   they have saved and closed the tab. Do not skip this for "probably
   nobody is editing right now" — the cost of being wrong is lost work.

3. **Verify no recent writes**: skim the last 30 seconds of Cloud Run logs
   for `tab.put.ok` events. If any, wait another minute and re-check. A
   writer may have missed your announcement.

4. **Merge the PR** and let Cloud Build auto-run.

## During deploy

Cloud Build triggers automatically from the merge to `main`. Takes ~4 min.

Watch the build: https://console.cloud.google.com/cloud-build/builds?project=comicsclient

While the build is running:
- Old container stays up, serving requests
- When the build finishes, Cloud Run starts the new container
- Old container receives SIGTERM, has 10 seconds to shut down before SIGKILL
- In that 10 seconds, the app's shutdown handler runs `wal_checkpoint(TRUNCATE)`
  and closes the DB, giving gcsfuse its last chance to upload pending writes
- New container starts, opens DB, begins serving

## Post-deploy verification

### Must-check (before announcing resume)

1. **New revision is live**. In Cloud Run console, confirm the latest
   revision's commit-sha label matches the merge commit.

2. **Durability settings active.** Look for `db.open` in the new container's
   logs. It must show:
   ```
   "journal_mode": "wal"
   "synchronous": 2        ← this means FULL. A value of 1 (NORMAL) = patch didn't apply.
   ```

3. **Periodic checkpoint firing.** Within the first 60-90 seconds of the
   new container, you should see at least one `db.checkpoint.tick` event.

4. **No shutdown errors on the OLD container.** Filter logs for the
   previous revision + `db.shutdown`. You should see:
   ```
   db.shutdown.start              signal: SIGTERM
   db.shutdown.checkpoint.ok      (with elapsedMs — ideally <1000ms)
   db.shutdown.close.ok           (with elapsedMs — ideally <500ms)
   ```
   If you see `db.shutdown.checkpoint.fail` or `db.shutdown.close.fail`,
   the graceful path didn't work. Flag it as a concern and investigate.

### Smoke test (optional but recommended on deploys that touch save paths)

1. Open a doc in the app, type a few characters, wait for the save indicator.
2. Within 60 seconds you should see `tab.put.fingerprint` in logs showing
   `walMtime` and `walSize` advancing vs the previous request.
3. Wait for a version snapshot — either force it by editing for 5 minutes,
   or just rely on the previous test. Verify `tab.version.fingerprint`
   appears with a new `contentHash` and on-disk files advancing.
4. Cross-check via GCS audit log (once enabled): a `storage.objects.update`
   on `writer.db-wal` should appear within ~60 seconds of the checkpoint.

### Announce resume

Post in the writers' channel:
> "Deploy complete. Safe to resume editing."

## If something looks wrong

### Checking for lost data post-deploy

If a writer reports lost work after a deploy, don't assume the worst. Check:

1. **Pull shutdown logs for the previous revision** (the one that got
   replaced). If `db.shutdown.start` did not fire, or `db.shutdown.close.ok`
   did not fire, the graceful path failed — data likely lost.

2. **Check GCS audit log** (if enabled) for the minute before the deploy.
   Did `writer.db-wal` get a final `storage.objects.update` call? If no,
   gcsfuse never flushed, data is gone.

3. **Query document_versions for the affected doc** — even if the tab
   content rolled back, a recent version snapshot may still exist and
   can be restored via the admin History panel.

4. **GCS soft-deleted generations** are retained 7 days. List with:
   ```
   gcloud storage ls --soft-deleted --long gs://ai-native-writer-db/writer.db
   ```
   Most recent generation before the deploy is recoverable.

### If the new container won't start

1. Check Cloud Run revision logs for startup errors.
2. If `db.open` never fires, the DB didn't open — likely a migration or
   schema issue. Revert by pinning traffic to the previous revision:
   ```
   gcloud run services update-traffic ai-native-writer \
     --region=asia-south1 \
     --to-revisions=<previous-revision-name>=100
   ```
3. Investigate without the pressure of prod being down.

## What this runbook does NOT promise

Even with perfect adherence, a writer who was typing RIGHT as the old
container got SIGTERM can still lose their last second or two of work.
The graceful shutdown gives gcsfuse up to 10 seconds to upload, but
there's no guarantee it finishes in that window.

The structural fix is migrating the database off gcsfuse (Turso, Cloud SQL,
etc.). When that ships, this coordination dance goes away and deploys
become zero-risk again.

## Related docs / memory files

- `ai-native-writer-db-scale.md` — DB scaling plan, currently has migration
  off gcsfuse as planned work
- `save-revert-investigation.md` — the 24-Apr-2026 incident post-mortem
