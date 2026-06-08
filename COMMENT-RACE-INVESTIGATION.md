# Comment Race Investigation — Bug #2 (save conflict) + Bug #3 (lost highlight)

**Status:** Investigation complete. **No code changed.** Awaiting decision on fix approach.
**Date:** 2026-06-08
**Author:** Claude (session with Vikas)
**Scope gate:** Vikas designated the poll/save subsystem as report-only this release. This document is the deliverable; implementation is deferred to approval.

---

## TL;DR

Bug #3 ("yellow comment doesn't highlight the referenced text") and Bug #2 ("adding a comment creates a save conflict") are **two symptoms of one race** between:

- the **reviewer poll**, which unconditionally overwrites the editor with server content every 5 s, and
- the **reviewer comment-mark save**, which sends the *entire* tab document (with the new mark) under `commentMarkOnly=true` on a 500 ms debounce.

Reviewers are the people who comment (owner writes; others review + comment), so both symptoms land on reviewers.

- If the **poll wins** the race → the just-applied mark is wiped before it persists → **Bug #3** (no highlight; can be permanent).
- If the **save fires on a stale doc** → server sees `commentMarkOnly` but content differs by more than marks → **Bug #2** (`suspicious.overwrite` warn + owner-content overwrite, or a 409 if the seatbelt is enabled).

---

## Bug #3 — the highlight is wiped by the reviewer poll

### Flow (reviewer posts a comment)
1. `CommentSidebar.handlePendingSubmit` → `addComment()` POSTs the comment row to `/api/comments`, then calls `onApplyCommentMark(markId)`.
2. `page.tsx` → `editorRef.current.applyCommentMark(markId, pendingComment.from, pendingComment.to)`.
3. `Editor.applyCommentMark` (`Editor.tsx:218`) applies the `commentMark` to `{from,to}` **locally** (yellow now visible) and calls `triggerSave()`.
4. `triggerSave` (`Editor.tsx:1005`) is a **500 ms debounce**; on fire it does `saveDocument(editor.getJSON())` with `commentMarkOnly=true` for reviewers.

### The wipe
The poll runs every **5 s**. The reviewer branch has **no in-flight guard** (`Editor.tsx:895-907`):

```js
if (!isOwner) {
  // Reviewers are read-only — always sync to server
  console.warn('[cmk-debug] REVIEWER POLL: overwriting editor', {...});
  editor.commands.setContent(serverContent, { emitUpdate: false });  // ← wipes local marks
  restoreCursor();
  return;
}
```

Contrast the **owner** branch just below it, which *is* guarded:
- `Editor.tsx:910` — skip if `saveStatusRef.current !== "saved"` (local save in flight)
- `Editor.tsx:919` — skip if `updatedAtMatch` (this is our own save echoing back)

If a poll tick lands in the window between step 3 (mark applied locally) and the 500 ms save persisting, the reviewer branch calls `setContent(serverContent)` — and the server content does **not** have the new mark yet → the highlight disappears.

### Why it can be permanent
`triggerSave`'s callback snapshots `editor.getJSON()` at **fire time**, not schedule time. If the poll wiped the mark before the debounce fires, the save persists the **mark-less** content. The mark is then gone from both client and server.

The pre-existing `[cmk-debug] REVIEWER POLL: overwriting editor` warning at `Editor.tsx:897` confirms this spot was already under suspicion in a prior session.

---

## Bug #2 — the save conflict (`suspicious.overwrite`)

### Mechanism
The reviewer save sends the **full tab document** with `commentMarkOnly=true` (`Editor.tsx:744-745`). The server (`/api/documents/[id]/tabs/[tabId]/content/route.ts`) diffs incoming vs current:

- `compareDocs` (`commentMarks.ts:113`) computes `nonMarkContentDiffers` = "differs by more than comment marks".
- `content/route.ts:340-342`: when `commentMarkOnly && nonMarkContentDiffers` → `warnTrace("tab.put.suspicious.overwrite")` **and still writes** the reviewer's doc to the server (`route.ts:366-373`).
- `content/route.ts:320-338`: if the **seatbelt** (`DEBUG_SAVE_SEATBELT`) is on, the same condition is instead **rejected with 409** ("Content diff exceeds commentMarkOnly scope"). Per the prior investigation, the seatbelt is currently **unset**.

### Why the reviewer doc is stale
The reviewer's editor can be behind the server when:
- the owner edited within the last 5 s (before the reviewer's next poll synced), or
- the comment was added in the same gap.

The reviewer then applies the mark to a **stale** doc and saves the whole thing. Result, depending on the seatbelt:
- **Seatbelt off (today):** server overwrites the owner's fresh text with the reviewer's stale text+mark → silent **data loss** for the owner; the owner's next poll sees the change and (if it's not mark-only) raises the conflict banner → the user-visible "save conflict."
- **Seatbelt on:** reviewer's PUT returns **409** → visible save error to the reviewer; no client retry exists today, so the comment mark never persists.

---

## Why they are the same bug

Both stem from the reviewer comment-mark design:
1. Reviewer poll **pulls** server→local unconditionally every 5 s.
2. Reviewer save **pushes** the *entire* doc local→server under a "marks only" flag.

When local and server drift even briefly, one of two things happens:
- poll wins → **mark wiped (Bug #3)**
- push wins on stale content → **suspicious.overwrite / conflict (Bug #2)**

Fixing one without the other just moves the race.

---

## Proposed fixes (ranked — for decision, NOT implemented)

### Option 1 — Symptom fix: guard the reviewer poll + flush on apply (low risk)
- **Poll:** in the reviewer branch, skip the overwrite while `saveStatusRef.current !== "saved"` (mirror the owner guard). Stops the poll wiping an in-flight mark.
- **Apply:** in `applyCommentMark`, flush the save immediately (await a direct `saveDocument`, bypassing the 500 ms debounce) so the server has the mark before the next poll reads it.
- **Fixes:** Bug #3 reliably. **Reduces** Bug #2 (smaller stale window) but does **not** eliminate the stale-content overwrite.
- **Risk:** Low. Reviewers still sync on every tick with no pending local save.
- **Files:** `Editor.tsx` (poll branch + `applyCommentMark`).

### Option 2 — Root fix for data loss: server applies the mark delta, not the whole doc (medium risk)
- When `commentMarkOnly && nonMarkContentDiffers`, the server stops trusting the reviewer's full doc. Instead it applies only `marksAdded`/`marksRemoved` onto the **current** server content.
- **Fixes:** Bug #2 data loss entirely — a comment save can never clobber the owner's text. Combined with Option 1, fully fixes both.
- **Risk:** Medium. Re-anchoring a mark's range onto possibly-shifted server content is non-trivial (positions move when the owner edits). Needs careful range mapping or storing marks by text anchor.
- **Files:** `content/route.ts`, `commentMarks.ts`.

### Option 3 — Architectural: store comment marks as a separate overlay (high risk, best long-term)
- Comments become `(commentId, anchor range)` rows decoupled from tab content; reviewers never PUT tab content. Eliminates the entire race class.
- **Risk:** High — schema + rendering rework. Out of scope for a bug-fix release; worth logging as a future item.

### Option 4 — Enable the existing seatbelt + client retry (medium risk)
- Turn on `DEBUG_SAVE_SEATBELT` so stale comment-mark PUTs 409 instead of silently overwriting; on 409 the client re-syncs to server, re-applies the mark on fresh content, retries.
- **Fixes:** Bug #2 data loss (reuses existing seatbelt infra) and, with Option 1, Bug #3.
- **Risk:** Medium. Needs new client retry logic; without it, a 409 just drops the comment mark.

**Recommendation:** **Option 1 + Option 2** (or Option 1 + Option 4 if Option 2's re-anchoring is judged too costly now). Option 1 alone ships the visible Bug #3 fix safely; Option 2/4 closes the Bug #2 data-loss hole.

---

## Must not break
- **Reviewers must still see the owner's live edits** — the reviewer poll overwrite is also the mechanism that delivers owner updates to read-only reviewers. Any guard must be scoped to "skip while a local mark save is pending," not "stop syncing."
- The `updatedAt` seconds-truncation fix (`content/route.ts:357-366`) and the lazy DB/auth init must be left intact.

## Observability already in place (use for verification)
- `[save-event] tab.put.suspicious.overwrite` — fires on the Bug #2 condition (always-on).
- `[save-event] tab.put.seatbelt.reject` — fires if the seatbelt is enabled.
- `[cmk-debug] REVIEWER POLL: overwriting editor` — fires every time the reviewer poll overwrites (Bug #3 wipe candidate).
- `client.poll.applyCommentMarks` / `client.save.*` — client trace via `/api/client-trace`.
- Log filter: https://console.cloud.google.com/run/detail/asia-south1/ai-native-writer/logs?project=comicsclient

## Verification plan (after a fix is chosen)
1. Two browsers: owner + reviewer on the same doc/tab.
2. Reviewer selects text, adds a comment → confirm the yellow highlight **persists** across ≥2 poll ticks (10 s+).
3. Owner edits text, then within 5 s the reviewer adds a comment on a different span → confirm **no owner data loss** and no `suspicious.overwrite`.
4. Confirm reviewers still receive owner edits within ~5 s (poll not over-throttled).

## Key files
- `src/components/editor/Editor.tsx` — `applyCommentMark` (218), poll (815-951), `triggerSave` (1005), `saveDocument` (721).
- `src/components/comments/CommentSidebar.tsx` — `handlePendingSubmit` (177).
- `src/app/doc/[id]/page.tsx` — `onApplyCommentMark` wiring (731), `pendingComment` (56).
- `src/app/api/documents/[id]/tabs/[tabId]/content/route.ts` — PUT save path, seatbelt (320), suspicious.overwrite (340).
- `src/lib/commentMarks.ts` — `compareDocs`, `isCommentMarkOnlyDiff`.
- `src/extensions/comment-mark.ts` — the mark (renders `.comment-highlight`; this part is correct).
