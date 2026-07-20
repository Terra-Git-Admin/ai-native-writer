# AI Native Writer — Performance Phase 1 (Execution Plan)

**Status:** ✅ PERFORMANCE FIXED (verified 2026-07-15). Backup 936ms (was 23–61s). msFinalRead 0–39ms (was 3–5s). One-time prune still pending (existing 89 MB DB not yet VACUUMed) — low urgency now. Console clean, no rate issues.
**ROOT CAUSE CONFIRMED (2026-07-15):** open latency is backup contention, not query cost. DB is **211 MB** and each backup runs **23–61s on a 60s interval** → main thread does SQLite backup work almost continuously → synchronous reads stall for seconds. See "Phase 1.6" below for the confirm evidence + fix plan.
**Scope:** Phase 1 only — behavior-neutral server/DB speedups + measurement. **No AI input/output change. No payload/API shape change.**
**Local repo:** `D:\plotpix\ai-native-writer`
**Prod:** Cloud Run (asia-south1), single instance (`max-instances=1`), SQLite at `/app/data/writer.db` (memory-backed container FS; **not** `/tmp` as earlier assumed — both are RAM on Cloud Run), GCS backup every 60s.

---

## Problem (confirmed by code trace)

1. **Opening a doc is slow.** `GET /api/documents/[id]/tabs` reads *all tab content three times* before responding:
   - `autoSplitIfNeeded` → `SELECT *` (content included) — `route.ts:69`
   - `healFixedTabs` → `SELECT *` (content included) — `tab-heal.ts:143`
   - final return → `SELECT *` (content included) — `route.ts:161`
   The first two are one-time migrations that re-read everything on **every** open just to decide "nothing to do" (true for all already-healed docs). Then the whole payload (every tab's full Tiptap JSON) is serialized and sent.

2. **No index on `tabs.document_id`** (`schema.ts:75`). Every tab query is a full-table scan across all docs' tabs. Same for `document_versions` and `comments`. Scans compound as tables grow — matches "worse as docs grew."

3. **Tab switch** flushes a save (`page.tsx:249` → PUT `.../content`) that awaits a full version-snapshot cycle (parse + diff + orphan scan + insert + count + prune, `content/route.ts:384`) before responding.

4. **`GET /tabs` emits no log at all** — we are blind on the exact slow operation.

## Why Phase 1 cannot touch AI (the constraint that shaped this)

The AI **chat** context is assembled **in the browser** from the client `tabs` array: `buildAIContext({ tabs, ... })` at `AIChatSidebar.tsx:578` reads `.content` for six tab types (Original Research, Characters, Series Skeleton, all Microdrama Plots, last 10 Predefined Episodes, active tab) — see `context-engine.ts:235–308`. That block is prepended to the user message and sent to the model.

**Therefore: slimming the `/tabs` payload would silently gut AI input.** That work is deferred to Phase 2. **Every change in this Phase 1 plan leaves the `/tabs` response shape and the client `tabs` cache byte-identical**, so `buildAIContext` receives exactly what it does today.

Client consumers of `tabs[].content` (all must keep working — Phase 1 does not disturb any):

| Consumer | Location | Reads |
|---|---|---|
| Chat context builder | `AIChatSidebar.tsx:578` | 6 tab types → **AI input** |
| Pilot-episode precheck | `AIChatSidebar.tsx:194` | Original Research |
| Cross-tab AI apply (append) | `page.tsx:433` | target tab content |
| Editor initial mount | `page.tsx:521` | active tab content |
| Outsiders View modal | `OutsidersPerspectiveModal.tsx:57` | selected episode tab |
| Quality Agent modal | `QualityAgentModal.tsx:63` | selected episode tab |

Durable AI **jobs** (workbook actions, Format, Pilot via `aiJob.start()`) re-fetch tabs from the DB server-side (`AIChatSidebar.tsx:202`) — unaffected regardless.

---

## Execution order

Ship in this order. Each step is independently deployable and independently measurable via the same log events.

```
Step 0  Instrument → baseline captured                  ✅ DONE (merged, deployed 2026-07-15)
Step 1a Indexes migration                               ✅ DONE (merged with 1b, deployed 2026-07-15)
Step 1b Remove heal functions entirely                  ✅ DONE (merged with 1a, deployed 2026-07-15)
Step 1c Non-blocking version snapshot on switch         branch: perf/phase1-step1c  (optional)
```

**Step 1b evolved:** originally planned as a skip-guard, changed to full removal after baseline confirmed healRan=false on 100% of prod samples and new docs are always born canonical. Smaller diff, same result.

---

## Step 0 — Instrumentation (ship first, alone, to get a clean baseline)

Use the existing `logEvent` from `@/lib/saveTrace` (same pattern already used by `db.open`, `tab.put.ok`, etc. — no new dependency). All events must include a `phase` string field so deploys can be filtered cleanly: `"baseline"` → `"idx"` → `"heal-skip"` → `"snapshot"`.

### 0.1 — `src/app/api/documents/[id]/tabs/route.ts` (GET)

Wrap the handler body with timing. Emit at the end (both the fast return and any early return):

```
logEvent("tabs.get.timing", {
  phase: "baseline",
  docId: id,
  tabCount,                 // rows.length of final read
  totalContentBytes,        // sum of (row.content?.length ?? 0) across rows
  healRan,                  // true if ANY heal fn actually mutated this open
  msHeals,                  // ms spent across the 3 heal fns
  msFinalRead,              // ms of the returning SELECT
  msTotal,                  // whole handler, auth-in to response-out
});
```

Timing helper: capture `const t0 = Date.now()` at top; `Date.now() - t0` at each checkpoint. `healRan` for the baseline = OR of the three heal functions' return values (they already return `boolean`).

### 0.2 — `src/app/api/documents/[id]/tabs/[tabId]/content/route.ts` (GET)

```
logEvent("tab.content.timing", {
  phase: "baseline",
  docId: id,
  tabId,
  contentBytes: tab.content?.length ?? 0,
  msTotal,
});
```

### 0.3 — same file, PUT (tab-switch flush path)

Add two fields to the existing `tab.put.ok` event:
```
msTotal,               // whole PUT handler
msVersionSnapshot,     // ms awaited inside maybeCreateTabVersion
phase: "baseline",
```

### Baseline capture protocol
1. Deploy Step 0 only.
2. Open each known-slow large doc 3–5 times; switch between its heaviest tabs; make one edit + switch (to exercise the flush PUT).
3. Pull from Cloud Run logs, filter `jsonPayload.event="tabs.get.timing"`.
4. Record per doc: `msTotal`, `msHeals`, `msFinalRead`, `tabCount`, `totalContentBytes`. `msHeals` quantifies the redundant-read waste directly. Also record `tab.content.timing.msTotal` and PUT `msTotal` / `msVersionSnapshot`.
5. Keep these numbers in this file under "Results" below.

> Assumption to confirm on execution: `logEvent` → stdout → Cloud Logging (consistent with existing `db.open` / `tab.put.ok`). If a different sink/dashboard is used, match field names to it.

---

## Step 1a — Indexes (behavior-neutral)

New migration file `drizzle/0007_perf_indexes.sql`:

```sql
CREATE INDEX `idx_tabs_doc_pos` ON `tabs` (`document_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_docver_doc_tab_created` ON `document_versions` (`document_id`,`tab_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_comments_doc_tab` ON `comments` (`document_id`,`tab_id`);
```

Add matching index definitions to `src/lib/db/schema.ts` so Drizzle stays in sync (third-arg callback on each `sqliteTable`, e.g.):

```ts
import { index } from "drizzle-orm/sqlite-core";
// tabs:        (table) => [index("idx_tabs_doc_pos").on(table.documentId, table.position)]
// documentVersions: [index("idx_docver_doc_tab_created").on(table.documentId, table.tabId, table.createdAt)]
// comments:    [index("idx_comments_doc_tab").on(table.documentId, table.tabId)]
```

Notes:
- Additive + reversible (drop index to roll back). No data change.
- Migrations run automatically at boot via `migrate()` in `db/index.ts:143`.
- Generate with `npx drizzle-kit generate` if you prefer, but hand-writing the SQL above is fine — just keep the `__drizzle_migrations` journal consistent.
- Flip instrumentation `phase` to `"idx"` on this deploy.

**Expected signal:** `msFinalRead` and PUT `msTotal` drop; effect grows with table size.

---

## Step 1b — Skip redundant heal reads on already-healed docs

In `src/app/api/documents/[id]/tabs/route.ts` GET, before the three heal calls, do **one metadata-only read** (no `content`):

```ts
const meta = await db
  .select({
    id: tabs.id,
    type: tabs.type,
    title: tabs.title,
    isProtected: tabs.isProtected,
    position: tabs.position,
  })
  .from(tabs)
  .where(eq(tabs.documentId, id))
  .orderBy(tabs.position);
```

Compute the cheap "already canonical" predicate — mirror `healFixedTabs`' `allAlreadyProtected` check (`tab-heal.ts:150`) plus the other two functions' guards:
- `defaultMain` guard: `meta.length > 0`
- `autoSplit` guard: `meta.length !== 1` (autosplit only fires on a single seed tab)
- `healFixed` guard: `meta.length >= CANONICAL_TABS.length && CANONICAL_TABS.every(spec => meta.some(r => r.type === spec.type && r.isProtected && r.title === spec.title))`

If **all three guards say "no-op"** → skip all heals, set `healRan = false`, proceed to the final content read.
Otherwise → fall through to the **existing, untouched** heal path (`healMissingDefaultTab` → `autoSplitIfNeeded` → `healFixedTabs`), set `healRan = true`.

Import `CANONICAL_TABS` from `@/lib/canonical-tabs` (already used by `tab-heal.ts`).

Correctness argument: for docs where the guards say no-op, the heal functions were already returning without mutating — so skipping them is behavior-identical. Un-healed docs (rare, first-open, or restored-from-old-backup) take the exact current path.

- Flip instrumentation `phase` to `"heal-skip"` on this deploy.

**Expected signal:** `msHeals` → ~0 for normal docs; `healRan=false` for the vast majority of opens. `msTotal` for open drops by roughly the previous `msHeals`.

---

## Step 1c — Non-blocking version snapshot on switch (optional, do last)

In `src/app/api/documents/[id]/tabs/[tabId]/content/route.ts` PUT: the tab content update (`db.update(tabs)...`) and `documents.updatedAt` bump stay **awaited** (durability of the actual save is unchanged). Only the **version snapshot** moves off the response path:

```ts
// was: await maybeCreateTabVersion(...)
if (isOwner && !commentMarkOnly && body.content) {
  void maybeCreateTabVersion(id, tabId, body.content, session.user.id, {
    force: forceVersion,
    reason: versionReason ?? undefined,
  }).catch((err) => {
    warnTrace("tab.version.failed", { docId: id, docTabIdPath: tabId, userId: session.user.id, err: err instanceof Error ? err.message : String(err) });
  });
}
```

Caveats to weigh at execution time:
- On single-instance Cloud Run this runs in the same process right after the response; a container kill in the gap could drop *that one* history snapshot (never the actual content save). Acceptable for version history, but confirm you're OK with it before shipping.
- Keep the existing `try/catch` semantics via `.catch`.
- If any test relies on the snapshot existing synchronously after the PUT resolves, adjust the test (await a tick) — do not re-block the handler.
- Flip instrumentation `phase` to `"snapshot"`.

**Expected signal:** PUT `msTotal` drops toward (`msTotal` − `msVersionSnapshot`); switch feels faster.

---

## Pre-push checklist (per project rules)

For each deploy:
1. `npm run build` — must exit clean (Turbopack dev does not catch all TS errors).
2. `npm run lint` — errors only; warnings ok. If errors: `npm run lint:fix` → re-check.
3. Feature branch (`perf/phase1-...`), PR into the repo's normal branch. Do **not** commit to `main` directly.
4. Confirm the deploy actually landed (webhook/remote runner — no live terminal logs): exercise the flow on the live URL or check the Cloud Run revision.
5. After deploy, verify **new-doc creation still works** on the live URL (heal path must still fire for a fresh doc — Step 1b must NOT skip heals for a brand-new/un-canonical doc).

## Verification (functional, before trusting the numbers)

- Open an existing large doc → renders correctly, all tabs present in rail.
- Open AI Assistant, send a chat message on a non-empty series → confirm the model still gets full context (spot-check response references research/characters/plots). This is the AI-unchanged guarantee — verify it, don't assume.
- Switch tabs → content loads, no stale content, no yellow "content mismatch" banner.
- Create a brand-new doc → canonical tabs seed correctly (heal path still runs for un-canonical docs).
- Version history still populates after edits (Step 1c).

## Rollback

- 1a: drop the three indexes (or revert migration).
- 1b: revert the guard block — heal functions run every open again.
- 1c: re-add `await`.
Each step is isolated; roll back individually without touching the others.

---

## Results (fill in during execution)

### Baseline samples (2026-07-15, phase=baseline)

| docId | tabCount | totalContentBytes | msHeals | msFinalRead | msTotal | healRan |
|---|---|---|---|---|---|---|
| xW1ImPiw0FFZ | 9 | 486,937 | 6,865 | 5 | 6,902 | false |
| 7FlPcURt6VU- | 7 | 272,362 | 2,196 | 3 | 2,208 | false |
| unKq3XDnfwjg | 6 | 147,526 | 5,578 | 3 | 5,639 | false |

**Finding:** 99%+ of open latency is `msHeals`. `msFinalRead` is 3–5ms across all docs. All `healRan=false` — heals ran 3 full SELECT * queries just to decide "nothing to do." msHeals variance (2–7s) likely reflects SQLite contention from concurrent requests, not content size.

### Heal-skip samples (2026-07-15, phase=heal-skip, revision ai-native-writer-00102-tlg)

| docId | tabCount | totalContentBytes | msHeals | msFinalRead | msTotal | healRan |
|---|---|---|---|---|---|---|
| PppUN5Sp8zWI | 11 | 584,564 | 0 | 4,689ms | 4,691ms | false |
| ywYGyZayoJ9j | 29 | 481,605 | 0 | 3,554ms | 3,556ms | false |

**Finding:** Heals are confirmed removed (msHeals=0, healRan=false). But msFinalRead is now consistently 3–5 SECONDS — 1000x slower than baseline's 3–5ms. The perf gain from removing heals was negated. Initial page load is also slow (separate symptom, not yet measured — flagged by user).

**Root cause — CONFIRMED (2026-07-15) via prod logs, backup contention.**
The earlier hypothesis in this doc ("sqlite.backup() runs on a libuv worker thread and holds the connection mutex") was **mechanistically wrong** — better-sqlite3 is synchronous main-thread bindings; `.backup()` does its copy work **on the main thread**, not a worker. Corrected mechanism, now confirmed by logs:

Evidence (revision ai-native-writer-00102-tlg, instance in asia-south1):
- `db.open` → `dbSize: 210890752` (**211 MB**), `walSize: 4445512` (4.4 MB), `synchronous: 2` (FULL), `walAutocheckpoint: 1000`, `backupIntervalMs: 60000`.
- `db.backup.snapshot.ok` → `durationMs: 61036` (bytes:0), `durationMs: 23601` (bytes:211357696), `durationMs: 835` (bytes:0).

Interpretation:
1. **DB is 211 MB** — bloated. `document_versions` holds up to 200 full-content Tiptap snapshots per (doc,tab) (`TAB_VERSION_HISTORY_LIMIT`, bumped 50→200) — the only plausible source of that volume. Confirm with per-table byte counts on execution.
2. **Backup runs 23–61s on a 60s timer** → the `_backupRunning` guard makes overlapping ticks skip, but a ~60s backup on a 60s interval means the process is doing backup work **almost continuously**. Any synchronous `db.select()` landing in that window stalls for seconds. That IS the relocated latency.
3. The `bytes:0` + 61s entries indicate SQLite's online backup **restarting from scratch** because the source DB is written during the copy (live editing). On a 211 MB DB under active use the backup may repeatedly restart → runs for a full minute.
4. WAL is small (4.4 MB) → **WAL is not the problem; main DB size is.** `/app/data/writer.db` is on the memory-backed container FS, so 211 MB DB + backup snapshot copy = real RAM pressure amplifying the stalls.

Baseline masked all this because the heal `SELECT *`s were first in line and absorbed the stall (huge `msHeals`); the final read ran after the window and looked fast.

### Summary table

| Metric | baseline | heal-skip (deployed) | retention — verified 2026-07-15 |
|---|---|---|---|
| open `msTotal` (range) | 2.2–6.9s | 3.6–4.7s | **~40ms ✅** |
| open `msHeals` (range) | 2.2–6.9s | 0 (removed ✅) | 0 |
| open `msFinalRead` | 3–5ms | **3.5–4.7s ❌** | **0–39ms ✅** |
| `totalContentBytes` / `tabCount` | 148–487 KB / 6–9 tabs | 481–584 KB / 11–29 tabs | |
| `dbSize` at boot | 211 MB | 211 MB | 89 MB (prune not yet run — WAL was 91 MB at boot, checkpointing) |
| backup `durationMs` | 23–61s | 23–61s | **936ms ✅** |
| backup `gzBytes` | — | — | 16.8 MB (compressed from 89 MB) |
| backup interval | 60s | 300s ✅ | 300s ✅ |
| console errors | — | — | **Clean ✅ — no rate issues, no 429s** |
| Tiptap warning | — | — | Pre-existing duplicate extension (`link`, `underline`) — not new |
| switch `tab.content.timing.msTotal` | 7–37ms | not yet measured | |
| PUT `msTotal` / `msVersionSnapshot` | (not yet measured) | | |

**Status:** ✅ Performance confirmed fixed. Backup contention eliminated — 936ms per backup cycle vs 23–61s. msFinalRead 0–39ms vs 3–5s. The 91 MB WAL at container boot (from previous session's accumulated writes) is normal and self-resolves via SQLite auto-checkpoint during use. One-time prune + VACUUM still pending (DB at 89 MB instead of expected ~15–30 MB) — low urgency since backups are now fast regardless.

---

## Phase 1.6 — Kill the backup contention (root-cause fix)

**Goal:** stop the periodic backup from stalling synchronous reads. Two independent levers; ship in order, measure each with the existing `db.open` `dbSize` and `db.backup.snapshot.ok` `durationMs` fields (no new instrumentation strictly required, but 1.6a below makes correlation airtight).

### 1.6a — (optional) airtight correlation, before fixing
Add to the `tabs.get.timing` event: `dbSize`, `walSize` (from `dbFileStats()`), and `backupRunning` (export `isBackupRunning()` from `persistence.ts`, returning the module `_backupRunning` flag). Expected: every slow open shows `backupRunning=true`. Skip only if the 211 MB / 23–61s evidence is already considered sufficient (it likely is).

### Lever 1 — SHRINK THE DB (highest leverage, attacks the root)
A smaller DB makes the backup cheap regardless of chunking, and relieves RAM pressure. `document_versions` (200 full-content snapshots/(doc,tab)) is the confirmed source of the 211 MB.

**DECISION LOCKED (Vikas, 2026-07-15): keep the Version History feature, shrink it. Do NOT delete.**
- What `document_versions` powers (verified): the Version History panel (`GET /api/documents/[id]/versions`) and Revert (`POST /api/documents/[id]/versions/revert`). It is a real user-facing feature, NOT plumbing for the tab-switch data-loss fix (that fix is the flush-on-switch + fresh-fetch in `page.tsx`, independent of snapshots).
- **Usage evidence:** ~5 `versions/revert` calls in the last week from real writers (e.g. doc `unKq3XDnfwjg`). Low volume, high value → writers revert to *recent* versions, so deep history is safe to drop. Deleting the feature is off the table.
- Note: snapshots already de-dup against the previous row's content (`content/route.ts:58`), so A→B→A with no edits does NOT create copies. Bloat is from the retention count (200), not duplication.

Steps:
1. **Confirm the culprit:** on execution, run per-table byte counts, e.g.
   `SELECT SUM(LENGTH(content)) FROM document_versions;` vs `... FROM tabs;` — expect document_versions to dominate.
2. **New retention RULE (Vikas's call, 2026-07-15):** per (doc, tab), keep **the 10 newest snapshots PLUS one "daily anchor" = the newest snapshot dated before today** (the last thing saved on the previous active day). So a writer always has both their recent session history AND a stable "where I left off yesterday" point, even after the 10 rolling slots have moved past it. Total kept ≈ 11 per (doc, tab).
   - Lower `TAB_VERSION_HISTORY_LIMIT` (`content/route.ts:29`) 200 → **10** for the rolling window.
   - Add the anchor to the prune logic in `maybeCreateTabVersion` (`content/route.ts:~110–145`) so the live prune keeps `newest 10 + newest row with created_at < start-of-today` — otherwise the anchor gets deleted on the next save.
   - **Implementation decision to pin:** the day boundary (use a consistent timezone — likely IST given the team — for "start of today"; simplest is compare against local midnight). "Previous day last session" is proxied by "newest snapshot before today's date" — we do not track sessions explicitly. Optional richer variant (cheap, ~7 extra rows/tab) if 1 anchor feels thin later: keep the last snapshot of each of the last 7 days.
3. **Stop the forced snapshot on tab switch** — keep forced snapshots on real saves, manual Ctrl+S, and pre-AI-apply (`ai_apply`), which are the meaningful recovery points. Removing the every-switch force slows how fast the 10 slots fill. **Exact site: `Editor.tsx:585` inside `flushPendingSave` (`reason: "tab-switch"`) — change `forceVersion: true` → `false`.** The other three force sites STAY: `Editor.tsx:967` (Ctrl+S, `reason: "manual-save"`) and `page.tsx:388` + `page.tsx:447` (both `reason: "ai_apply"`). The throttled auto-save (1/5min) still captures edits made before the switch.
4. **One-time prune** of existing rows down to the new rule (newest 10 + daily anchor) per (doc,tab). Maintenance script / migration, then a manual `forceBackup` so the shrunk DB lands in GCS. **`VACUUM` after the mass delete** — SQLite does not return freed pages to the OS without it, so the 211 MB file stays 211 MB (on disk AND in every backup) until vacuumed.
5. **Re-measure** `dbSize` and backup `durationMs`. Expected: ~211 MB → ~15–30 MB, backup ~60s → about a second. Target: backup well under a few seconds.

Tradeoff (recorded): a writer can undo through their last ~10 saved states (roughly the current working session) AND jump back to where they ended the previous day (the anchor). The remaining gap: mid-history days between "recent 10" and "yesterday's anchor" aren't kept. Reverts are rare and recent, so this is low-risk; reversible if writers ask for more (bump 10, or switch to the 7-day-anchor variant). Bigger alternative if depth must grow a lot: move version history to a separate SQLite file or to GCS, out of the hot DB.

### Lever 2 — DECONTEND / DE-RESTART THE BACKUP
Even with a smaller DB, harden the backup so it can't monopolize the main thread or restart forever:

1. **Chunk the backup with a `progress` callback** so each step copies a small number of pages and yields to the event loop between steps:
   `await sqlite.backup(snapshotPath, { progress() { return 200; } })` (tune page count). This bounds how long the main thread is held per step and lets reads interleave. **Verify better-sqlite3's default step behavior** — if the default is a single synchronous pass, this is the decisive fix; if it already chunks, this still tightens it.
2. **Raise `BACKUP_INTERVAL_MS` 60s → 300s (5 min) — DECISION LOCKED (Vikas, 2026-07-15).** (`db/index.ts:42`, env var — set `BACKUP_INTERVAL_MS=300000` on the Cloud Run service, or change the default.) Fewer contention windows. Trade-off: on an *ungraceful* crash you could lose up to the last 5 min of edits instead of 1 min — but graceful SIGTERM still flushes via `shutdownBackup` (deploys/scale-downs are graceful), so real exposure is only a hard crash mid-session. Low risk, accepted.
3. **Address backup restarts:** a 61s / bytes:0 backup = source written mid-copy → restart loop. A `wal_checkpoint(PASSIVE)` before the backup, or backing up from a short read-transaction snapshot, reduces restarts. Simplest mitigation is Lever 1 (small DB copies before a write can interrupt it) + chunking.
4. **Revisit `synchronous=FULL`→`NORMAL`** (`db/index.ts:57`) — reduces per-commit fsync stalls on the write path; safe under WAL given 60–300s GCS backups. Secondary.

### Lever ordering / expected outcome
Lever 1 first (shrink + vacuum) — likely collapses backup duration from 23–61s to sub-second by itself, which removes the contention window. Then Lever 2 (chunk + interval) as durable hardening so bloat can't reintroduce the stall. Re-measure `msFinalRead` / open `msTotal` after each.

### Track C — Initial page load (separate symptom, not yet measured)
The slow *initial* doc-page load is distinct from the `/tabs` API contention. Likely `max-instances=1` cold starts + Next.js client bundle size. Measure on its own — server TTFB for the doc page, bundle size, hydration time — before proposing a fix. Do NOT conflate with the backup work above.

### AI guarantee (unchanged)
None of Phase 1.6 touches the `/tabs` payload or the client `tabs` cache. `buildAIContext` input is byte-identical. Lever 1 only changes how many *historical version snapshots* are retained — it does not affect current tab content or AI context.

---

## Phase 1.6 — Executor Implementation Spec (copy-paste ready)

This section is the handoff contract. Every edit below is verified against the current code (2026-07-15). Do these in order. **Ship Lever 1 (Changes 1–4) first and measure before touching Lever 2 (Change 5).**

### Pre-flight facts (verified against current source — do not re-derive)

- **Indexes already exist** in `schema.ts` (`idx_tabs_doc_pos`:105, `idx_comments_doc_tab`:129, `idx_docver_doc_tab_created`:152). Before assuming they're live in prod, confirm inside the container: `PRAGMA index_list('document_versions')` must list `idx_docver_doc_tab_created`. If missing, the migration didn't apply — fix that first (it's the index the retention prune relies on).
- **The live prod DB exists only inside the running container** at `/app/data/writer.db` (memory-backed FS; persisted to GCS solely via the backup loop). **A script on your laptop cannot reach it.** Therefore the one-time prune (Change 4) MUST run inside the container — via a temporary admin route, then removed.
- **`createdAt` is stored as integer seconds** (`{ mode: "timestamp" }`). Drizzle deserializes it to a JS `Date` on read, so `Date`-vs-`Date` comparisons in JS work. The existing raw-SQL delete divides by 1000 (`content/route.ts:139`) — you are replacing that whole block, so that detail goes away.
- **The four `forceVersion:true` sites** — drop only the first, keep the rest:

  | Site | reason | Action |
  |---|---|---|
  | `Editor.tsx:585` (`flushPendingSave`) | `tab-switch` | **change to `false`** |
  | `Editor.tsx:967` (Ctrl+S) | `manual-save` | keep |
  | `page.tsx:388` (AI apply) | `ai_apply` | keep |
  | `page.tsx:447` (AI apply) | `ai_apply` | keep |

- **`forceBackup` is exported from `persistence.ts`** but needs the raw `Database` handle + path. Those live in `index.ts` as module-private `_sqlite`/`_dbPath`. Change 4 adds a tiny exported wrapper rather than re-plumbing them.

### Change 1 — retention constant + new prune rule (`content/route.ts`)

**1a.** Line 29: `const TAB_VERSION_HISTORY_LIMIT = 200;` → `= 10;`. Update the comment block above (lines 26–28) that says "Prunes to last 200" to describe the new rule.

**1b.** Add `inArray` to the drizzle import on line 5:
`import { and, desc, eq, inArray, sql } from "drizzle-orm";`

**1c.** Add this helper above `maybeCreateTabVersion` (IST day boundary — locked timezone):
```ts
// Start of "today" in IST (UTC+5:30). The daily-anchor rule keeps the newest
// snapshot from BEFORE this instant so a writer always has a stable
// "where I left off previously" restore point.
function startOfTodayIST(): Date {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const nowIst = Date.now() + IST_OFFSET_MS;
  const istMidnight = Math.floor(nowIst / 86_400_000) * 86_400_000;
  return new Date(istMidnight - IST_OFFSET_MS);
}
```

**1d.** Replace the entire prune block (`content/route.ts:107–145`, from the `// Prune beyond...` comment through the closing `}` of the `if ((count[0]?.count ?? 0) > ...)` branch) with:
```ts
  // Retention: keep the newest TAB_VERSION_HISTORY_LIMIT snapshots PLUS one
  // "daily anchor" = the newest snapshot from before today (IST). The anchor
  // survives even after the rolling window scrolls past it, so a writer can
  // always jump back to where they left off on a previous day.
  const rows = await db
    .select({
      id: documentVersions.id,
      createdAt: documentVersions.createdAt,
    })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.tabId, tabId)
      )
    )
    .orderBy(desc(documentVersions.createdAt));

  if (rows.length > TAB_VERSION_HISTORY_LIMIT) {
    const keep = new Set<string>();
    for (let i = 0; i < TAB_VERSION_HISTORY_LIMIT && i < rows.length; i++) {
      keep.add(rows[i].id);
    }
    const startOfToday = startOfTodayIST();
    const anchor = rows.find((r) => r.createdAt < startOfToday);
    if (anchor) keep.add(anchor.id);

    const toDelete = rows.filter((r) => !keep.has(r.id)).map((r) => r.id);
    if (toDelete.length > 0) {
      await db
        .delete(documentVersions)
        .where(
          and(
            eq(documentVersions.documentId, documentId),
            eq(documentVersions.tabId, tabId),
            inArray(documentVersions.id, toDelete)
          )
        );
    }
  }
```
Notes: (i) at limit=10 the `SELECT id,createdAt` returns ~11–12 rows in steady state — cheap, no content column. (ii) The `inArray` keep-set approach is robust to second-precision timestamp ties (the old offset-cutoff delete was not). (iii) If the anchor already falls inside the newest 10 (writer hasn't saved since before today), the Set dedups it — no-op, correct.

### Change 2 — stop the tab-switch forced snapshot (`Editor.tsx:585`)

In `flushPendingSave`, line 584–587, change `forceVersion: true` → `false` and update the 580–583 comment to note that tab-switch now relies on the throttled auto-save (still forced on Ctrl+S and pre-AI-apply). The content PUT itself is unchanged — tab-switch still saves the actual edit; only the *forced version row* is dropped.

### Change 3 — backup interval 60s → 300s (LOCKED)

No code change required. Set the env var on the Cloud Run service (staging first, then prod):
```
gcloud run services update <service> --region <region> \
  --update-env-vars BACKUP_INTERVAL_MS=300000
```
(staging = `stage-...`/asia-south2, prod = `.../asia-south1` — confirm exact service names with `gcloud run services list`). Reversible: re-set to `60000`. Read at `index.ts:42`. Graceful SIGTERM still flushes via `shutdownBackup`, so exposure is only a hard crash mid-session (≤5 min of edits).

### Change 4 — one-time prune + VACUUM + backup (temporary admin route, runs IN the container)

Lowering the limit (Change 1) only shrinks a (doc,tab) on its *next save* — existing 211 MB won't clear on its own. This route reclaims it immediately. **VACUUM is mandatory**: SQLite does not return freed pages to the OS (or to the backup copy) without it.

**4a.** Add an exported wrapper in `index.ts` (so the route can trigger a backup with the private handle):
```ts
export async function forceBackupNow(): Promise<void> {
  if (!_sqlite || !_dbPath) return;
  await forceBackup(_sqlite, _dbPath);
}
```

**4b.** Add a temporary route `src/app/api/admin/prune-versions/route.ts` (admin-gated). Sketch:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, forceBackupNow } from "@/lib/db";
import { documentVersions } from "@/lib/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

const LIMIT = 10;
function startOfTodayIST(): Date { /* same helper as content/route.ts */ }

export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // 1. Distinct (doc, tab) pairs.
  const pairs = await db
    .select({ documentId: documentVersions.documentId, tabId: documentVersions.tabId })
    .from(documentVersions)
    .groupBy(documentVersions.documentId, documentVersions.tabId);

  let totalDeleted = 0;
  const startOfToday = startOfTodayIST();
  for (const p of pairs) {
    if (!p.tabId) continue; // legacy null-tab rows: decide keep/skip explicitly
    const rows = await db
      .select({ id: documentVersions.id, createdAt: documentVersions.createdAt })
      .from(documentVersions)
      .where(and(eq(documentVersions.documentId, p.documentId), eq(documentVersions.tabId, p.tabId)))
      .orderBy(desc(documentVersions.createdAt));
    if (rows.length <= LIMIT) continue;
    const keep = new Set(rows.slice(0, LIMIT).map((r) => r.id));
    const anchor = rows.find((r) => r.createdAt < startOfToday);
    if (anchor) keep.add(anchor.id);
    const toDelete = rows.filter((r) => !keep.has(r.id)).map((r) => r.id);
    // Chunk inArray to stay well under SQLite's param limit.
    for (let i = 0; i < toDelete.length; i += 400) {
      const chunk = toDelete.slice(i, i + 400);
      await db.delete(documentVersions).where(
        and(eq(documentVersions.documentId, p.documentId), eq(documentVersions.tabId, p.tabId), inArray(documentVersions.id, chunk))
      );
      totalDeleted += chunk.length;
    }
  }

  // 2. Reclaim disk. VACUUM cannot run in a transaction and needs no
  //    concurrent writer — run during low traffic.
  await db.run(sql`VACUUM`);

  // 3. Push the shrunk DB to GCS now (don't wait for the next tick).
  await forceBackupNow();

  return NextResponse.json({ ok: true, pairs: pairs.length, totalDeleted });
}
```
Run once (`curl -X POST .../api/admin/prune-versions` while logged in as admin), confirm the JSON result + the next `db.open`/`db.backup.snapshot.ok` show the smaller `dbSize`/duration, then **delete this route in a follow-up commit**. Caveats to weigh: VACUUM on a 211 MB DB rebuilds the whole file (~2× transient space, brief DB stall) — memory-backed FS means a short RAM spike; fine at this size but do it off-peak. Decide explicitly what to do with legacy `tabId IS NULL` rows (the sketch skips them).

### Change 5 — Lever 2 hardening (optional; only if still slow after Lever 1)

Measure first. A ~15–30 MB DB should back up in ~1s, which alone removes the contention window. If open latency is still elevated:
- **Chunk the backup** at `persistence.ts:264`: `await sqlite.backup(snapshotPath, { progress() { return 200; } })`. **Verify better-sqlite3's default step behavior before relying on this** — if its default already yields per-N-pages this is marginal; if it's a single synchronous pass it's decisive.
- **`synchronous = FULL` → `NORMAL`** at `index.ts:57` — cuts per-commit fsync stalls on the write path; safe under WAL with periodic GCS backup. Secondary.

### Deploy & verify sequence (Phase 1.6)

1. Branch `perf/phase1.6-version-retention` off the repo's working branch (never `main`).
2. `npm run build` clean, `npm run lint` (errors only).
3. Deploy Changes 1 + 2 + the admin route (Change 4). Set `BACKUP_INTERVAL_MS=300000` (Change 3) on the service.
4. Run the admin prune once → confirm `dbSize` drops (`db.open`) and `db.backup.snapshot.ok durationMs` falls from 23–61s toward ~1s.
5. Re-measure open latency: `tabs.get.timing msTotal`/`msFinalRead` should drop from ~3.5–4.7s back toward the baseline few-ms. Record in Results below (add a `phase="retention"` column).
6. Functional checks (below) — especially: Version History panel still lists recent versions, Revert still works, and a fresh edit still creates a snapshot.
7. Remove the temporary admin route in a follow-up commit.
8. Only then consider Change 5 if numbers are still off.

**AI-unchanged re-verify (mandatory):** after deploy, send an AI chat message on a non-empty series and confirm the model still receives full context. Nothing here touches `/tabs` or `buildAIContext`, but verify, don't assume.

---

## Deferred to Phase 2 (do NOT start here)

Slim the open payload via `?meta=1` fast-path + background hydration of `tabs[].content`, with AI-send gated on hydration and full-list fallback. This is the only part that touches what the AI receives, so it needs its own design + explicit sign-off. See the Phase 2 discussion in session notes.
