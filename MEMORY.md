# MEMORY.md — AI Native Writer

Decision log and session summaries. Read at every session start.

---

## Session — 2026-07-20 (Multi-Step Episode Pipeline — LOCAL TESTING COMPLETE, ready for staging)

- **Status:** All 8 build-steps coded + local testing done end-to-end. Branch `feat/multi-step-episode-pipeline`. NOT pushed to staging yet.
- **Bugs fixed during local testing:**
  1. **Gating broken** — stub H1-only tabs read as non-empty. Fixed: strip `[H1]` lines, require >30 chars.
  2. **No lock reason shown** — added `requiredTabLabel`; shows `"Fill [Tab] first"` on disabled buttons.
  3. **Input visible on all tabs** — conditioned on `activeTab.type === "workbook"`.
  4. **UI redesign** — removed all old WorkbookActions (skeleton, pilot, plot chunks). Sidebar: compact Actions section (2×2 pipeline grid + "Create Pre-defined Episode" below it) → large streaming/messages area → input (workbook only).
  5. **History clear on step click** — pipeline step button confirms "Run X? This will clear chat history." then clears before firing.
- **Create Pre-defined Episode retained** — `next_reference_episode` aiJob (server-side pipeline). Standalone button below pipeline grid. Discard/Append to Workbook flow intact.
- **Tab unlock lag (known, deferred)** — unlock doesn't refresh until tab-switch. Root cause: parent `tabs` state only updates on tab-switch. Fix = parent save flow must push updated content into `tabs`. Separate task.
- **Backfill confirmed working locally** — `POST /api/admin/backfill-pipeline-tabs`: 44 docs, 40 updated.
- **Full pipeline tested:** Build World → copy to World State → Suggest Beats unlocks → Connect Story → Write Plots. All 4 agents produce output.
- **Next:** push branch to staging → run backfill on staging → E2E test on staging → PR to main.

---

## Session — 2026-07-17 (Multi-Step Episode Pipeline — PLAN AUDITED vs live code → v1.1; EXECUTE TOMORROW 18 Jul)

- **Worked on:** Full code audit of the finalized plan against the live repo before handing to a 4.6 executor. Planning only — still **NOT CODED**.
- **Verdict:** AI/route half (Files A–D minus tab bits) accurate. Tabs half (File E) was materially wrong — rewritten in the feature doc (now v1.1).
- **Blockers found & fixed in the doc:**
  1. Wrong path — canonical tabs live at `src/lib/canonical-tabs.ts`, NOT `src/lib/db/canonical-tabs.ts`.
  2. Backfill design was dead — plan said add `ensurePipelineTabs` on the tabs GET load path, but **heal-on-load was removed for perf** (tabs GET now logs `heal-skip`/`healRan:false`; single SQLite instance). Re-adding per-GET writes = the exact regression from the July perf crisis.
  3. New tab types must be added to `classify()` in `src/lib/tab-heal.ts` or `healFixedTabs` demotes them to "custom" and reshuffles positions. Plan never mentioned `tab-heal.ts`.
- **Accuracy fixes in doc:** `renderTab` is a non-reusable closure (use exported `tiptapJsonToTagged`); plot spec is **11 `[P]` blocks** but its own closing line at prompts.ts `:2326` mis-says "Ten" (fix on copy); sidebar `mode` is hardcoded `"chat"` (`:137`) + closure deps must include `activeStep`; `VALID_TYPES` (tabs route `:10-21`) needs the 3 new types; thinking hardcoded ON + model `claude-sonnet-4-20250514` in route (`:65,:77`).
- **CONFIRMED true:** `tabs.type` is plain text at `schema.ts:87` (`:75` is just the `sqliteTable(` line) → NO migration. `AIChatSidebar` already has `tabs`+`activeTab` props → gating needs no new plumbing. Route `Mode`/`FALLBACK_PROMPTS`/`getSystemPrompt` anchors correct.
- **Two founder decisions LOCKED:** (1) existing-doc backfill = **one-time admin route** (`POST /api/admin/backfill-pipeline-tabs`, mirror `prune-versions/route.ts`), NOT a load-path hook; (2) integration = **fold the 3 tabs into `CANONICAL_TABS`** + extend `CanonicalTabType` + `classify()`, reusing the seed/repair path (no parallel seeder).
- **Still unverified before handoff:** pilots actually live in predefined Episode 1 (build-step 1's 2nd assumption) — confirm against a real doc.
- **Next session (18 Jul): START EXECUTING** from build-step 1 with the v1.1 feature doc + refreshed mirror. Both banners still say NOT CODED until then.

## Session — 2026-07-17 (Multi-Step Episode Pipeline — PLAN FINALIZED, NOT CODED)

- **Worked on:** Full interactive planning of the Multi-Step Episode Pipeline (replaces the broken Series Skeleton flow). Planning only — **no code written, no branch, no repo changes.**
- **Deliverable (shareable, executor-ready for a 4.6 session):** `D:\plotpix\FEATURES\feat-multi-step-episode-pipeline.md` (mirror: `C:\Users\vikas\.claude\plans\playful-hopping-barto.md`). Both carry a clear "NOT CODED" banner.
- **Decisions locked (final):**
  - 4 steps on the **inline chat path** (`/api/ai/edit`), NOT durable jobs: Build World → Suggest Beats → Connect the Story → Write Plots.
  - AI drafts into **chat**; writer transfers to Workbook, edits, then **manually moves** to each step's locked final tab. Filling that tab (non-empty) gates/unlocks the next step's button. No auto-apply, no code lock action.
  - **3 new tabs** (`world_state`, `beat_sequence`, `story_logic`) + existing `microdrama_plots` for output. **No DB migration** — `tabs.type` is a text column (confirm `schema.ts:75` before build).
  - **Fixed minimal context per step** via new `buildPipelineStepContext` — never `buildAIContext`. Per-step SENDS/EXCLUDES contract kills dilution (user's explicit concern). Build-step 3 is an echo-stub "dilution gate" to verify.
  - Build World targets the **SERIES end** (post-pilot state + series-end destination from OG story arc), not pilot end.
  - Plots match the existing 11-paragraph `NEXT_EPISODE_PLOT_SYSTEM_PROMPT` format; causality (Story Logic) tab feeds the Plot Arc / Phase fields the skeleton used to supply. 4 new prompts.
- **Open assumptions the executor must confirm first:** (1) `tabs.type` is text (no CHECK enum); (2) pilots live in predefined Episode 1.
- **Next session priorities:** hand the feature doc to a fresh 4.6 session; execute from build-step 1. Skeleton decommission is a separate later PR after this is proven.

## Session — 2026-05-29

- **Worked on**: Pilot Episode Agent + Research Agent improvements
- **Completed**:
  - PR #61 — merged and deployed to prod
  - Rewrote CLAUDE.md to follow project template (was long technical reference, now structured session file)
  - Pilot Episode pre-check: if Original Research empty, opens Research Agent instead of failing
  - Research Agent: first response auto-applies to Original Research tab (markdown → structural tags)
  - End-to-end flow: Research Agent opened from Pilot Episode flow → after research saves, pilot job fires automatically (panel closes, AI sidebar opens, job starts)
  - `pilotPendingRef` in page.tsx tracks whether Research Agent was opened from Pilot flow — manual opens don't auto-trigger pilot

- **Key files changed**:
  - `src/components/ai/AIChatSidebar.tsx` — added `onOpenResearchAgent` prop + pilot pre-check in `handleStartJob`
  - `src/components/ai/ResearchAgentPanel.tsx` — added `tabs`, `onApplyToTab`, `onResearchApplied` props; `researchMarkdownToTagged()` conversion; auto-apply on first message
  - `src/app/doc/[id]/page.tsx` — wired `pilotPendingRef`, `onOpenResearchAgent`, `onResearchApplied`

- **Decisions made**:
  - Pilot pre-check is client-side (checks `tabs` state via `tiptapJsonToTagged`) — faster than letting job fail server-side
  - Research auto-apply fires only on first message (`messages.length === 0` before send) — follow-up questions don't overwrite the tab
  - Pilot auto-trigger only when `pilotPendingRef === true` — prevents unexpected pilot jobs when Research Agent opened manually

- **Next session priorities**:
  - Improve Pilot Episode prompt (user mentioned wanting to work on this)
  - Improve Research Agent prompt (user mentioned wanting to work on this)

---

## Session — 2026-06-08

- **Worked on**: ai-native-writer bug batch (one release) — Pilot button + char-routing, Pilot prompt quality, comment save-conflict + lost-highlight investigation. Branch `fix/pilot-routing-and-comment-bugs` (commit `98c3a5d`), build passed, **NOT pushed**.

- **Completed**:
  - **Bug #1 (code)** — Research Agent dumped its whole report (incl. `## Characters`) into the Original Research tab, leaving the Characters tab empty → Pilot job hard-failed on the empty-Characters guard (`actions.ts:371`). Two reported symptoms ("pilot button broken" + "characters in wrong tab") were ONE root cause. Fix: `ResearchAgentPanel.tsx` now `splitResearchAndCharacters()` routes the `## Characters` section → Characters tab (rest → Original Research), awaited BEFORE the pilot auto-fires. `markdownToTagged(text, h1Title)` (renamed from `researchMarkdownToTagged`).
  - **Bug #1b (prompt)** — rewrote `PILOT_EPISODE_SYSTEM_PROMPT`: purpose = CONVERSION (north star); cold-open framing; hook doctrine (lead-character reveal + sensory grab + planted question in first 5–10s; forbidden-openings list); THREE genuinely different pilots on one spine (NOT same-middle, may deviate from source); cliffhanger never resolved. Removed the two contradictions ("follow Episode 1 plot exactly", "differ ONLY in hook+cliffhanger / use best middle") that were causing the sameness. Aligned `actions.ts` pilot context label + task line. Kept working bones (output format, hard rules, imported craft modules).

- **In progress / handed off**:
  - **Bugs #2 + #3 = ONE reviewer poll/save race** (report-only per Vikas — protected code). Root cause: reviewer poll branch (`Editor.tsx:895-907`) unconditionally overwrites the editor every 5s with no in-flight guard, racing the 500ms debounced commentMark save. Poll wins → highlight wiped; stale push wins → `suspicious.overwrite`. Full root-cause + 4 ranked fix options in **`COMMENT-RACE-INVESTIGATION.md`**. Awaiting Vikas's fix-option decision.

- **Decisions made**:
  - All 3 bugs ship as one release branch; #2/#3 report-only — do NOT touch the protected poll/save code without approval.
  - Bug #1 fix approach = split characters to Characters tab (chosen over softening the pilot guard).
  - Pilot prompt = targeted rewrite (purpose/hook/options/cliffhanger), keep the working craft scaffolding.

- **Next session priorities**:
  - Push branch + open PR to `main` (run `npm run build` first — passed this session).
  - Live-verify on a real doc: run "Write Pilot Episode" with populated Original Research + Characters → confirm characters land in Characters tab, pilot fires, 3 options genuinely divergent with strong character-reveal hooks.
  - Decide a #2/#3 fix option from `COMMENT-RACE-INVESTIGATION.md` (recommended: Option 1 poll-guard + flush, plus Option 2 server mark-delta).
  - Optional: Vikas to paste good Pilot outputs → calibrate prompt voice/format.

---

## Session — 2026-06-10

- **Worked on**: Context misuse cluster — diagnosis and backlog entry. No code changed.

- **Completed**:
  - Read CLAUDE.md, MEMORY.md, ERRORS.md, COMMENT-RACE-INVESTIGATION.md at session start — full state restored.
  - Added 3 new issues (skeleton context, wrong agent trigger, finalized-copy regression) to BACKLOG.md as a single cluster entry with root-cause framing and high-level fix architecture.
  - Updated CLAUDE.md Known open issues with the context cluster.

- **Decisions made**:
  - These 3 issues are NOT to be patched piecemeal — they share one root cause: the AI call is stateless, always re-reads raw tabs, has no concept of approved/working-copy state.
  - Agreed 3-layer fix architecture: (A) working-copy / accepted-state concept, (B) per-mode context scoping declarations, (C) agent trigger isolation (button-only, never keyword-inferred).
  - Fix order: Layer 3 first (trigger isolation — cheap, surgical), then Layer 1 (working copy — highest user-visible impact), then Layer 2 (context scoping — cleanup).
  - Next step is an RCA dive into context assembly code before any implementation.

- **In progress / handed off**:
  - Branch `fix/pilot-routing-and-comment-bugs` (commit `98c3a5d`) still unpushed — still needs push + PR.
  - Comment race (#2/#3) still report-only, fix-option decision still pending.

- **Next session priorities**:
  - Push `fix/pilot-routing-and-comment-bugs` + open PR to `main`.
  - RCA dive: read context assembly code (`AIChatSidebar.tsx`, `route.ts`, `actions.ts`) to understand exactly how context is built per mode and where agent triggers are detected.
  - Decide fix option for comment race (#2/#3).
  - Propose scoped implementation plan for the context cluster (3 layers) before writing any code.

---

## Session — 2026-07-01

- **Worked on**: New "Plot Arc Discipline" structural concept for microdrama plot generation — a Foreshadow → Anticipation → Action → Reaction causal cycle per plot thread, requested by Vikas to stop episodes from introducing disconnected/random events. PR #75, merged and deployed same session.

- **Completed**:
  - Research grounding: mapped the concept to established craft (Dwight Swain's Scene/Sequel MRU cause-effect chain, Frank Daniel's 8-Sequence Structure, "domino plotting") — confirmed no single canonical source, it's a synthesis, and said so.
  - Ran an independent audit agent (fresh context, told to be skeptical) against the draft before implementing. It caught 2 critical bugs: (1) the spine would've been treated as one perpetual 45-episode arc, permanently burning a concurrency slot; (2) the series finale would've been incorrectly flagged as an "orphan arc." Both fixed before merge.
  - Found and reconciled a collision the audit agent couldn't see (no file access): `MICRODRAMA_SERIES_ENGINE`'s existing Escalation Ladder (5-8 eps, tension curve) and `MICRODRAMA_STORY_ENGINE`'s Plant-and-Payoff (15-ep window, object/phrase devices) sit in a similar episode-count envelope to the new Plot Arc (3-6, max 8) — added explicit "not the same as" language so the model doesn't conflate them.
  - Implemented in `prompts.ts`: `PLOT ARC DISCIPLINE` hard rule + `[H2] Plot Arc Map` output section + 2 new Structural Audit lines, added to both `SERIES_SKELETON_SYSTEM_PROMPT` and `SERIES_SKELETON_PREDEFINED_SYSTEM_PROMPT`. Matching `PLOT ARC STAGE TRACKING` rule + 10th output field added to `NEXT_EPISODE_PLOT_SYSTEM_PROMPT`.
  - Reprioritized `NEXT_EPISODE_PLOT_SYSTEM_PROMPT`'s inputs: previously-written Predefined Episodes (ground truth, now windowed to last 8) and the plot chain now outrank the Series Skeleton, which is demoted to "phase pacing + Plot Arc Map — authoritative only for what hasn't happened yet." Mirrors the PR #67/#74 precedent where the skeleton was found to go stale against what's actually written.
  - Fixed a factual error in the original pilot-linkage idea: there's no code path exposing Pilot Episode content to the Skeleton/Plot agents (3 variants are manual, never auto-merged) — corrected to ground Arc 1 in "Episode 1 as actually written" instead.
  - `loadNextEpisodePlotContext` in `actions.ts` updated: windows `predefinedEpisodes` to last 8 (was last 1, cliffhanger-only), reorders and relabels the assembled context.
  - `npx tsc --noEmit` and `npm run build` both clean before and after the final cherry-pick.
  - Caught and fixed a git hygiene issue mid-flow: the working branch (`feat/predef-episode-context-depth`) was stale — its base commit (PR #74) was already squash-merged to `main`, and `main` had moved 2 commits ahead. Fixed by cherry-picking the new commit onto a fresh branch off `origin/main` (`feat/plot-arc-discipline`) rather than pushing from the stale branch.
  - PR #75 merged (squash) into `main` at `eca6f41`. Cloud Build auto-deployed — confirmed live via `gcloud run revisions describe`: revision `ai-native-writer-00096-p6t`, created 3 min after merge, `commit-sha` label matches the merge commit exactly.

- **Decisions made**:
  - Shipped without live-testing the actual generation output first — explicit instruction from Vikas ("merge now as is") after being offered the option to live-test first. Flagged clearly before merging that this carries risk since there's no automated test coverage for prompt quality.
  - Concurrency cap of 2 is documented as a "generation-reliability guardrail for a single-pass LLM," not asserted as narrative law — so a future editor doesn't treat it as inviolable craft doctrine.
  - Did not touch `PLOT_CHUNKS_SYSTEM_PROMPT` (similar-shaped feature, intentionally disabled per CLAUDE.md) — treated as separate, out of scope.
  - Did not touch the orphaned `EPISODE_PLOT_ADAPTATION_WORKFLOW` (seeded as `adaptation_workflow` but not wired into any live route) — confirmed dead code, left alone.

- **Next session priorities**:
  - **Live-verify** (highest priority — shipped untested): regenerate a Series Skeleton on a real/test doc, check the Plot Arc Map is coherent and the concurrency cap holds; run Next Episode Plot on a doc with an existing skeleton + written episodes, check Plot Arc stage tracking and the ground-truth-over-skeleton precedence behave as intended.
  - Watch for: the Plot Arc Map going stale relative to actually-written episodes since nothing auto-regenerates it (flagged as an open risk during design — a written note tells the writer to periodically re-run Series Skeleton generation, but there's no enforcement).
  - Still pending from earlier sessions: comment race (#2/#3) fix-option decision; `fix/pilot-routing-and-comment-bugs` branch status should be checked (may be stale/already merged — verify before reusing, per this session's git-hygiene lesson).

---

## Session — 2026-07-14

- **Worked on**: Storyboard feature — per-beat image generation from predefined episodes. Admin-only.

- **Completed**:
  - `src/app/api/documents/[id]/visualize/route.ts` — new. Admin-only gate (`role === "admin"`). Two-step: (1) single `gemini-2.5-flash` call converts all beats (Visual | Dialogue | VO) to N image prompts as JSON — system prompt emphasises story communication (who/where/emotion/dialogue staging), not cinematography; (2) `Promise.allSettled` fires all N Imagen 3 calls in parallel (16:9). Individual beat failures return a grey placeholder; they do not kill the whole response. Accepts optional `episodeIndex` in body (0-based); default = latest.
  - `src/components/ai/StoryboardPanel.tsx` — new right-side panel (520px). Auto-fetches on mount. Vertical scroll of beat cards: Beat N pill + beat text + image + synthesized prompt in italic. Failed beats show error text in a grey box. Loading state has spinner + time estimate.
  - `src/app/doc/[id]/page.tsx` — `storyboardOpen` state; "Storyboard" toggle button in toolbar (fuchsia, admin + predefined_episodes tab only, sits next to Quality Agent); renders StoryboardPanel when open.
  - Updated CLAUDE.md: Storyboard added to AI Agents table + key files table.
  - Updated BACKLOG.md: Storyboard added to Done.

- **Decisions made**:
  - Admin-only (not owner-accessible). Follows Quality Agent pattern — same role check, same toolbar placement.
  - Single LLM call for all N prompts (not one call per beat) — cheaper and gives the LLM episode-level context for each prompt.
  - Image prompts framed as story communication, not cinematography: system prompt asks what characters feel toward each other, what the setting reveals, what the dialogue/VO means for the story — no shot types, camera angles, or lighting rigs.
  - No episode picker for now — always visualises the latest episode. A picker can be added later using the existing QualityAgentModal pattern + `episodeIndex` body param already wired in the API.
  - No GCS storage — images returned as base64 in the response. Acceptable for admin/preview use; persistent storage is a later decision.
  - Button toggles the panel (re-opens = re-generates latest episode). No caching.

- **Storyboard — Imagen 3 blocked (NOT working yet)**:
  - `imagen-3.0-generate-001` → 404 on `generativelanguage.googleapis.com/v1beta`. Tried `imagen-3.0-generate-002` → same 404.
  - Root cause: the Google API key stored in DB (`aiSettings` id: "google") is a Gemini API key. Imagen 3 is NOT available via the Gemini API endpoint — it requires **Vertex AI** (`aiplatform.googleapis.com`), which uses service account auth (not an API key).
  - Fix needed: switch `callImagen3()` to the Vertex AI REST endpoint. Auth = GCP service account (already available in Cloud Run via the default service account). No API key needed for the image gen call — only the Gemini API key usage in Step 1 stays.
  - Currently in prod: Step 1 (prompt generation via gemini-2.5-flash) works. Step 2 (Imagen 3 call) 404s for every beat, returning error cards.

- **Next session priorities**:
  - Switch `callImagen3()` to Vertex AI endpoint: `POST https://us-central1-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/us-central1/publishers/google/models/imagen-3.0-generate-001:predict` with Bearer token from metadata server
  - 429/rate-limit fix still pending (GA model default + honor Thinking toggle + `onError` on streamText)
  - Comment race (#2/#3) fix-option decision still open

---

## Session — 2026-07-15

- **Worked on**: Performance Phase 1 — instrumentation + three DB/server optimizations. All 4 steps implemented as separate git branches (plan written previous session in PERF-PHASE1.md).

- **Completed**:
  - `perf/phase1-step0` — baseline instrumentation only. `tabs.get.timing` (msTotal, msHeals, msFinalRead, healRan, tabCount, totalContentBytes), `tab.content.timing` (msTotal, contentBytes), `tab.put.ok` gains msTotal + msVersionSnapshot + phase. Await preserved everywhere. Phase tag: "baseline".
  - `perf/phase1-step1a` — migration 0007 adds three indexes: `idx_tabs_doc_pos` (document_id, position), `idx_docver_doc_tab_created`, `idx_comments_doc_tab`. Schema.ts updated with Drizzle index defs. Phase: "idx".
  - `perf/phase1-step1b` — heal skip guard. Meta-only SELECT (no content) before the three heal functions. Skips all three when doc is already canonical (needsDefaultHeal=false, needsSplit=false, needsFixedHeal=false). Un-healed docs still take full path. Phase: "heal-skip".
  - `perf/phase1-step1c` — version snapshot moved off response path (void + .catch). Content save still awaited. msVersionSnapshot always 0 in logs. Phase: "snapshot".
  - All 4 branches build clean. Guard correctness verified: docs with archive tabs still trigger needsFixedHeal correctly.

- **Decisions made**:
  - Steps ship as separate branches (not one branch) so per-step baseline measurement is possible via the phase log field.
  - Step 1c trade-off accepted per plan: container kill between response and snapshot could drop one version row, never the content itself.
  - Phase 2 (payload slimming, would touch AI context) explicitly deferred — do NOT start without a separate design session.

- **Baseline measured (2026-07-15):**
  - 3 docs sampled: msTotal 2.2–6.9s, msHeals 2.2–6.9s, msFinalRead 3–5ms, all healRan=false.
  - Root cause confirmed: 99%+ of open latency is the 3 heal functions doing full SELECT * on every open just to return false. Actual content read is 3–5ms.
  - Results logged in PERF-PHASE1.md.

- **Steps 1a + 1b deployed (2026-07-15):**
  - Step 1b evolved: instead of a skip-guard, removed heal functions entirely. Baseline confirmed healRan=false on 100% of samples. New docs born canonical via buildCanonicalTabRows. Smaller, cleaner change.
  - Merged both as one commit to main (ffe9e3b), Cloud Build triggered.

- **Next session priorities**:
  - Check logs after deploy — open a doc, filter tabs.get.timing, confirm msTotal drops from 2–7s to under 50ms.
  - Fill in heal-skip column in PERF-PHASE1.md Results table.
  - Optionally deploy perf/phase1-step1c (fire-and-forget version snapshot) if PUT msVersionSnapshot baseline is significant.
  - 429/rate-limit fix (providers.ts preview model + honor thinking toggle + onError on streamText) — see 3 Jul session notes.
  - Imagen 3 Vertex AI fix (callImagen3 → Vertex AI endpoint with metadata server auth).

---

## Session — 2026-07-03

- **Worked on**: Diagnosis of three prod issues — (1) "Rate exceeded." error, (2) "AI request failed" in AI Assistant, (3) dash slowness. Read-only investigation, NO code changed. Diagnosed from `C:\Users\vikas` — implementation must happen in a project-rooted terminal.

- **Findings — #1 "Rate exceeded."**:
  - Exact string `"Rate exceeded."` exists in ZERO source files (grep-confirmed). It is the raw HTTP 429 body from the **Google Generative Language API frontend** — a per-project rate/quota limit — leaking through unhandled.
  - Root causes in code that accelerate hitting it:
    1. **Preview model everywhere.** `providers.ts:20` defaults to `gemini-3.1-pro-preview`; `AIChatSidebar.tsx:401` hard-pins the chat sidebar to it; `outsiders-chat/route.ts:155` hardcodes it. Preview models carry far lower RPM/TPM/RPD quotas than GA models.
    2. **Thinking always on.** `edit/route.ts:64` calls `getAIModel(modelId, true)` (hardcoded `true`); `edit/route.ts:76-79` + `jobs.ts:273-276` always send `google: { thinkingConfig: { thinkingBudget: 10000 } }` regardless of the UI toggle → inflates TPM every request.
    3. **One shared API key + `max-instances=1, concurrency=50`** → all writers' requests hit the same project quota concurrently; each request carries tens of thousands of input tokens (context = last 6–8 eps + skeleton + plots; one episode tab alone was 24,720 chars).

- **Findings — #2 "AI request failed"**:
  - It's the fallback string at `AIChatSidebar.tsx:438` (`data.error || "AI request failed"`), shown only when the response is non-2xx AND body isn't parseable JSON — so the real reason (same 429) is swallowed.
  - `streamText` is not awaited and has **no `onError`** in `edit/route.ts:82` and `jobs.ts:279`. `toTextStreamResponse()` returns 200 immediately, so a mid-stream 429 dies silently / truncates and the `edit/route.ts:84` try/catch can't catch it. No retry/backoff, no model fallback.

- **Findings — #3 dash slowness**:
  - Architectural ceiling: `max-instances=1` + synchronous `better-sqlite3` (every DB call blocks the single Node event loop; can't scale horizontally because SQLite is single-writer).
  - `auth()` runs a synchronous SQLite session lookup on every API route. Doc-page load waterfall: `document`+`tabs` (parallel, ok) → `comments` → `models`, plus a fresh content fetch per tab switch (`doc/[id]/page.tsx:259`) — each a blocking round-trip on the one instance.
  - **Stale memory note corrected**: "DB backup blocks event loop + uploads 0 bytes" is NO LONGER true. `persistence.ts` was rewritten to GCS-direct with async `sqlite.backup()` to `/tmp` (real disk, off the request path). Minor residual cost: `fs.readFile(gzPath)` loads whole gz into memory for two parallel `.save()` + read-after-write `getMetadata()` verify — not on the hot path.

- **Decisions made**:
  - **#1/#2 fix = GA model default + honor the Thinking toggle. Do NOT reduce input** (would regress the PR #74/#75 context-window expansion). Reducing input only helps if the bottleneck is TPM; moving off preview → GA raises the ceiling regardless of RPM vs TPM.
  - **Logging**: don't add standalone logging. Jobs path already logs the raw reason (`jobs.ts:336` `ai_job.run.failed`) → read Cloud Run logs FIRST to confirm the exact quota dimension (RPM vs TPM vs RPD). Chat/outsiders paths get their logging for free by adding `onError` to `streamText` (which is also the fix for #2's opacity).
  - **#3**: real fix is SQLite → Cloud SQL (Postgres) so `max-instances` can exceed 1 (already flagged in `ai-native-writer-db-scale.md`). Everything else (JWT session to cut per-request DB hits, waterfall trims) is a band-aid until then.

- **Next session priorities**:
  1. Pull Cloud Run logs, filter `ai_job.run.failed` → confirm the quota dimension being hit (RPM/TPM/RPD) and the exact Gemini error text.
  2. Fix #1+#2 on a `fix/` branch in a project-rooted terminal: switch default model off preview → GA; honor the Thinking toggle (drop hardcoded `true` + gate `thinkingConfig`); add `onError` to `streamText` in `edit/route.ts`, `outsiders-chat/route.ts`, `jobs.ts` (surface + log real error); add a GA-model fallback + backoff for 429s. `npm run build` before push.
  3. Scope the Cloud SQL migration as its own plan (the durable #3 fix).

---

## Session — 2026-07-15 (perf phase 1 execution)

- **Worked on**: PERF-PHASE1.md execution plan — instrument → baseline → remove heals → deploy

- **Completed**:
  - Step 0: instrumentation deployed (`tabs.get.timing`, `tab.content.timing`, `tab.put.ok` with phase/timing fields)
  - Step 1a: indexes migration (`drizzle/0007_perf_indexes.sql`) — `idx_tabs_doc_pos`, `idx_docver_doc_tab_created`, `idx_comments_doc_tab`
  - Step 1b: heal functions removed entirely (`healMissingDefaultTab`, `autoSplitIfNeeded`, `healFixedTabs` + all imports). Baseline confirmed healRan=false on 100% of prod samples → full removal, not skip-guard
  - Steps 1a+1b merged and deployed together (commit ffe9e3b) after branch stacking merge conflict resolved by squash-merge

- **Baseline measurements** (old revision, phase=baseline):
  - xW1ImPiw0FFZ: 9 tabs, 487KB, msHeals=6865ms, msFinalRead=5ms, msTotal=6902ms
  - 7FlPcURt6VU-: 7 tabs, 272KB, msHeals=2196ms, msFinalRead=3ms, msTotal=2208ms
  - unKq3XDnfwjg: 6 tabs, 148KB, msHeals=5578ms, msFinalRead=3ms, msTotal=5639ms

- **Heal-skip measurements** (new revision ai-native-writer-00102-tlg, phase=heal-skip):
  - PppUN5Sp8zWI: 11 tabs, 584KB, msHeals=0, msFinalRead=4689ms, msTotal=4691ms
  - ywYGyZayoJ9j: 29 tabs, 481KB, msHeals=0, msFinalRead=3554ms, msTotal=3556ms

- **Problem**: removing heals shifted the bottleneck — total latency unchanged at 3.5–4.7s. msFinalRead is now the slow path (was 3–5ms on old revision, now 3–5s on new).

- **Root cause hypothesis**: GCS backup loop (`sqlite.backup()` every 60s) holds SQLite's internal connection mutex while copying pages. Old revision: heals "accidentally" waited out the backup window. New revision: SELECT hits the mutex immediately. Also: initial page load is slow (not yet diagnosed).

- **Decisions made**:
  - Heal removal is correct and permanent — msHeals=0 confirmed, healRan=false on all samples
  - msFinalRead fix requires separate planning session — do not execute here
  - Initial load slowness flagged as separate symptom to diagnose

- **Next session priorities**:
  1. Feed PERF-PHASE1.md to planning model → get diagnosis + fix plan for msFinalRead bottleneck and initial load slowness
  2. Execute the plan (likely: backup loop throttling, or WAL checkpoint interval tuning)
  3. Verify msFinalRead drops to <50ms after fix

---

## Session — 2026-07-15 (phase 1.6 execution)

- **Worked on**: Phase 1.6 — version history retention fix to kill backup contention root cause

- **Completed**:
  - PR #80 merged → revision `ai-native-writer-00103-drx` live
  - `TAB_VERSION_HISTORY_LIMIT` 200 → 10 with daily IST anchor rule (newest snapshot before today always kept as stable restore point)
  - Prune logic replaced: old offset-cutoff delete → keep-set + `inArray` delete (correct under timestamp ties)
  - `forceVersion` dropped on tab-switch (`Editor.tsx:585`). Only Ctrl+S and pre-AI-apply (`ai_apply`) still force snapshots. Tab content still saved on switch — only the forced version row removed
  - `forceBackupNow()` exported from `index.ts` for admin route use
  - Temporary `POST /api/admin/prune-versions` route added — iterates all (doc,tab) pairs, deletes rows beyond 10+anchor, runs VACUUM, triggers GCS backup
  - `BACKUP_INTERVAL_MS=300000` set on Cloud Run service via `gcloud run services update`
  - Build clean, lint errors are all pre-existing (auth.ts, index.ts Proxy line — do not touch)

- **Decisions made**:
  - Version History feature kept (5 reverts/week from real writers confirmed). Retention reduced, not removed
  - IST timezone locked for daily anchor boundary — consistent with team location
  - Legacy `tabId IS NULL` version rows skipped by the prune route — separate decision needed if those need pruning too
  - tab-switch `forceVersion: false` is correct — filling the 10-slot window on every tab switch defeats the retention limit immediately

- **In progress / blocked**:
  - **One-time prune BLOCKED**: `POST /api/admin/prune-versions` returns 429 "Rate exceeded" on every call — the existing 211 MB of old version rows is still in the DB. Backups still run 23–61s. msFinalRead still 3–5s. Fix for the 429 blocker is being planned separately (brief sent to planning model)
  - The 429 fires before auth — comes from app-level rate limiting middleware, not Cloud Run. Path `/api/admin/*` needs to be exempted OR the prune needs to run via a different mechanism (Cloud Run job, gcloud exec, etc.)

- **Next session priorities**:
  1. Execute planning model's fix for the 429 blocker on the admin prune route
  2. Run the prune, confirm `dbSize` drops in `db.open` logs
  3. Delete `src/app/api/admin/prune-versions/route.ts` in a follow-up PR after prune confirmed
  4. 429/rate-limit fix on AI calls (GA model default, honor Thinking toggle, onError on streamText) — separate from the prune 429 issue
  5. Imagen 3 Vertex AI fix (`callImagen3` → Vertex AI endpoint)

---

## Session — 2026-07-15 (perf verification)

- **Verified**: Performance fix confirmed working in prod (revision ai-native-writer-00104-vsl)

- **Key numbers**:
  - `db.backup.snapshot.ok durationMs`: **936ms** (was 23–61s) ✅
  - `tabs.get.timing msFinalRead`: **0–39ms** (was 3–5s) ✅
  - `backupIntervalMs`: 300,000 confirmed ✅
  - `gzBytes` per backup: 16.8 MB (89 MB DB compressed)
  - `dbSize` at boot: 89 MB (down from 211 MB — WAL was 91 MB at boot, self-resolves via auto-checkpoint)

- **Console check**:
  - No rate issues, no 429s, clean console ✅
  - Pre-existing Tiptap warning: `Duplicate extension names found: ['link', 'underline']` — fires on every editor mount via `refreshEditorInstance`. Not new, not related to perf work. `link` and `underline` registered twice (likely StarterKit + explicit). Harmless but worth fixing separately.

- **All changes are live** — PR #80 merged → Cloud Build auto-deployed. No further merges needed for what's done. BACKUP_INTERVAL_MS set directly on service via gcloud (env var, no code change).

- **Still pending (low urgency)**:
  - One-time prune + VACUUM — DB at 89 MB instead of ~15–30 MB. Not urgent since backups are fast (936ms) regardless of DB size at 89 MB.
  - Admin prune route 429 blocker still unresolved — planning model brief sent.

- **Next session priorities**:
  1. Fix 429 on `/api/admin/prune-versions` (planning model's fix) → run prune → delete route
  2. 429/rate-limit fix on AI calls (GA model, Thinking toggle, onError)
  3. Imagen 3 Vertex AI fix
