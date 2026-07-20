# AI Native Writer — CLAUDE.md

## What this is

An AI-native scriptwriting tool for a team producing vertical mobile microdramas. One writer owns a document, others review and comment. Built as a self-hosted Next.js app on Cloud Run. Supports multi-turn AI agents for series drafting, episode adaptation, research, quality evaluation, and pilot episode generation. Writers work with structured content (series overview, characters, episode plots, reference episodes, predefined episodes) inside a rich-text editor.

## Stack

| Concern | Technology |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript, Tailwind v4) |
| Editor | Tiptap v3 (ProseMirror-based, custom extensions) |
| Database | SQLite via Drizzle ORM + better-sqlite3 (`data/writer.db`) |
| Auth | NextAuth.js v5 — Google OAuth only |
| AI | Vercel AI SDK v6 (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/google`) |
| Deployment | Cloud Run (asia-south1), auto-deploy from `main` via Cloud Build |
| Repo | `Terra-Git-Admin/ai-native-writer` |

## Running locally

```bash
cd /d/plotpix/ai-native-writer && npm run dev   # starts on :3000
```

`BYPASS_AUTH=true` in `.env.local` skips Google OAuth (redirect URI not registered for localhost).
DB auto-created at `data/writer.db` on first run. Gitignored.

## Key files

| File | Purpose |
|---|---|
| `src/app/api/ai/edit/route.ts` | Single AI endpoint — handles all modes (edit, draft, feedback, format, chat, agents) |
| `src/lib/ai/prompts.ts` | All 25 prompt constants — source of truth on server restart; upserted to DB |
| `src/app/api/prompts/route.ts` | Prompt DB seeding — registers all prompt IDs in DEFAULTS |
| `src/components/ai/AIChatSidebar.tsx` | Chat sidebar — mode detection, streaming, signal protocol, change parsing |
| `src/components/editor/Editor.tsx` | Tiptap editor — `replaceRange`, `findAndReplace`, `highlightSelection`, `CommentMark` |
| `src/components/editor/WorkbookActions.tsx` | Workbook tab action buttons — triggers agent job kinds |
| `src/components/ai/StoryboardPanel.tsx` | Admin storyboard panel — per-beat image cards (beat text + image + prompt); auto-fetches on mount |
| `src/app/api/documents/[id]/visualize/route.ts` | Storyboard API — admin-only; gemini-2.5-flash prompt gen + parallel Imagen 3 calls |
| `src/lib/db/index.ts` | Lazy DB singleton + Proxy — **do not rewrite** (see Architecture) |
| `src/lib/auth.ts` | Lazy NextAuth init — **do not rewrite** (see Architecture) |
| `src/lib/db/schema.ts` | Drizzle schema — run `npx drizzle-kit push` after changes |

## Active Work

- **Prod URL**: https://ai-native-writer-936494534526.asia-south1.run.app/
- **Latest shipped**: PR #75 — Plot Arc Discipline (Foreshadow/Anticipation/Action/Reaction) + Next Episode Plot context reprioritized over skeleton (merged 1 Jul 2026)
- **Total prompts in DB**: 25 (seeded from `prompts.ts` on restart)
- **Cloud Run config**: `max-instances=1` (SQLite single-writer), `concurrency=50` (bumped 22 Jun 2026 from 20 — 429s under multi-user load)

### Predefined Episode Format (as of PR #65 — 15 Jun 2026)

`CANONICAL_REF_EPISODE_FORMAT` and `NEXT_REFERENCE_EPISODE_SYSTEM_PROMPT` were significantly updated. Key format changes writers and downstream systems must know:

- **Seq N headers**: every scene change opens with `[P] Seq N — Location | Time of day | Characters present`
- **`[tone]` tags**: required on every TYPE B dialogue line and TYPE C V.O. line — `"line" [tone]`
- **Quotes mandatory**: all spoken dialogue in double quotes — without them batch_gen cannot extract lines
- **Spatial framework**: scene-opening Visual beats encode GEOGRAPHY / FORCES / STATE ARC
- **V.O. required**: when a character receives a revelation they cannot voice aloud — not optional
- **Pre-emit checks**: PREPARED ANSWER (physical beat before verbal response), SILENCE (devastating moment must freeze first), V.O., QUOTES — run on draft before emitting

### Predefined Episode Context Priority (as of PR #74 — 29 Jun 2026)

`next_reference_episode` job context order (highest → lowest influence):
1. **Writer guidance** — text typed in chat before triggering the job (`userGuidance`); overrides everything
2. **Last 6 reference episodes** — window (not full chain); model mines for character state, events, revelations, relationship shifts, and what each character knows — plus voice + scene pickup
3. **Microdrama plot** — structural blueprint for the episode being expanded
4. **Characters** — voice consistency only

System prompt now tells the model it has a **partial window** (not full chain) — it infers earlier context from what the visible episodes reference rather than assuming it has seen everything.

Series Skeleton is **excluded** from general chat context on the `predefined_episodes` tab (it was leaking in and confusing scene-level generation).

### Series Skeleton Format (as of PR #69 — 23 Jun 2026)

Both `SERIES_SKELETON_SYSTEM_PROMPT` and `SERIES_SKELETON_PREDEFINED_SYSTEM_PROMPT` output a new format:

**Plotline Architecture** — each plot is `[H3] Plot A (Spine): <name>` + one narrative paragraph. No sub-fields (Arc / Central question / Emotional engine / Phase trajectory / Key reveals).

**Phase Breakdown** — each phase is `[H3] Phase N: <Title>` (no episode range) + free narrative `[P]` paragraphs. No episode numbers, no `OPEN → BEAT → CLOSE` labels. Typically 3–6 paragraphs per phase.

**Section order** — Plotline Architecture and Phase Breakdown come first. Series Summary + Supporting Reference (Cast, Arc Evolution, Structural Audit) are below a `─────` separator.

**Predefined regen delta** — when regenerating against an existing skeleton, a compact `[H2] Changes from Previous Skeleton` block appears after `[H1]`, with one `[P] •` bullet per changed/added/removed plot. Block omitted entirely if no plots changed.

### Plot Arc Discipline (as of PR #75 — 1 Jul 2026)

New structural layer between Plotline (whole-series) and Episode (single ep): a **Plot Arc** is a 3-6 episode (never more than 8) causal unit inside a Plotline, cycling through 4 stages in order:
1. **Foreshadow** — the plant; must name the specific event from the prior arc's Reaction that triggers it
2. **Anticipation** (1-3 eps) — the dramatic question sharpens, stakes escalate
3. **Action** — the confrontation/reveal actually happens
4. **Reaction** (1-2 eps) — the fallout, concrete enough to serve as the next arc's Foreshadow trigger

**Concurrency cap**: max 2 Plot Arcs active at once (spine's current arc + at most one branch's current arc) — framed as a generation-reliability guardrail, not narrative law. The spine is a *chain* of 5-7 arcs, not one 45-episode arc. Each plotline's terminal arc is exempt from triggering a next arc (its Reaction is the character's resolution instead).

**Series-opening arc**: Arc 1 is seeded by Episode 1 as actually written — never by "the pilot." The Pilot Episode job produces 3 manual draft variants with no auto-merge path into canonical continuity, so neither Skeleton nor Next Episode Plot has visibility into pilot content.

**Does not overlap** with the existing Escalation Ladder (`MICRODRAMA_SERIES_ENGINE` — tension curve), Plant-and-Payoff (`MICRODRAMA_STORY_ENGINE` — object/phrase devices), or Session boundaries (viewer pacing) — explicitly reconciled in the prompt text since all three land in a similar 5-8 episode envelope.

**Where it lives**: `SERIES_SKELETON_SYSTEM_PROMPT` + predefined variant get a new `[H2] Plot Arc Map` output section (after Phase Breakdown) + 2 new Structural Audit lines (Arc chain, Orphan arcs). `NEXT_EPISODE_PLOT_SYSTEM_PROMPT` gets a `PLOT ARC STAGE TRACKING` hard rule + a 10th output field (`Plot Arc stage`).

Design was independently audited before shipping — caught and fixed two structural bugs: the spine would have been treated as one perpetual 45-episode arc, and the series finale would have been flagged as an "orphan arc" bug.

**Not yet done**: live-verify by actually regenerating a Series Skeleton and a Next Episode Plot on a real doc to confirm the model follows these rules sensibly — shipped without that test pass per explicit instruction.

### Next Episode Plot Context Priority (as of PR #75 — 1 Jul 2026)

`next_episode_plot` job context order (highest → lowest influence) — reordered to demote the Skeleton, mirroring the PR #74 fix already applied to `next_reference_episode`:
1. **Previous Predefined Episodes** — window of last 8 (was: only the last 1, cliffhanger-pickup only). Ground truth — mined for drift from plot summaries, each active Plot Arc's actual stage, and current character knowledge/emotional state.
2. **All Existing Microdrama Plots** — full chain, unchanged.
3. **Series Skeleton** — demoted from "AUTHORITATIVE" to "phase pacing + Plot Arc Map — authoritative only for what hasn't happened yet." Ground truth (1, 2) overrides it for anything already plotted or written.
4. **Characters** — unchanged, voice consistency only.

`loadNextEpisodePlotContext` in `actions.ts` updated to match — windows `predefinedEpisodes` to `.slice(-8)` instead of taking only the last section.

### Multi-Step Episode Pipeline (PLAN AUDITED v1.1 — NOT CODED — EXECUTION STARTS 18 Jul 2026)

New writer-driven flow to replace the broken Series Skeleton → Skeleton-to-Plots path (skeleton stays until this is proven, then decommissioned). Produces microdrama plots that feed the unchanged Plot → Predefined flow. **Nothing implemented yet** — executor-ready spec (v1.1, for a Claude 4.6 session) is in `D:\plotpix\FEATURES\feat-multi-step-episode-pipeline.md` (mirror: `C:\Users\vikas\.claude\plans\playful-hopping-barto.md`). Execute from build-step 1.

Key architecture decisions (final): 4 steps on the **inline chat path** (`/api/ai/edit`), NOT durable jobs — Build World → Suggest Beats → Connect the Story → Write Plots. AI drafts into chat; writer transfers to Workbook, edits, then **manually moves** to each step's locked final tab; filling that tab gates the next step. 3 new tabs (`world_state`, `beat_sequence`, `story_logic`) + existing `microdrama_plots` for output — **no DB migration** (tabs.type is text, confirmed `schema.ts:87`). **Fixed minimal context per step** via a new `buildPipelineStepContext` (never `buildAIContext`) with a per-step SENDS/EXCLUDES contract to kill dilution. Build World targets the **series end** (post-pilot state + series-end destination). Plots match the existing 11-paragraph `NEXT_EPISODE_PLOT_SYSTEM_PROMPT` format; causality tab feeds the Plot Arc / Phase fields. 4 new prompts.

**Audit corrections (v1.1, 17 Jul) — critical for the executor:**
- Canonical tabs = `src/lib/canonical-tabs.ts` (NOT `src/lib/db/`). The 3 new tabs FOLD INTO `CANONICAL_TABS` + extend `CanonicalTabType` + extend `classify()` in `src/lib/tab-heal.ts` (unrecognized types get demoted to "custom" and reshuffled otherwise).
- **Heal-on-load is OFF** (tabs GET route, perf). Do NOT backfill existing docs on load — existing-doc backfill is a **one-time admin route** (`POST /api/admin/backfill-pipeline-tabs`, mirror `prune-versions/route.ts`), run once manually.
- `renderTab` is a non-reusable closure inside `buildAIContext` — call exported `tiptapJsonToTagged` directly. Plot spec is 11 `[P]` blocks (prompt's own "Ten" at `prompts.ts:2326` is a typo). Sidebar already has `tabs`+`activeTab`; `mode` is hardcoded `"chat"` (`:137`) — thread `activeStep` through. Add new types to `VALID_TYPES` in tabs POST route.

### Pending (NOT pushed)

- **Comment race (#2/#3)** — reviewer poll/save race investigated, report-only. Fix-option decision pending. See `COMMENT-RACE-INVESTIGATION.md`.

### AI Agents (all in `src/components/ai/` + `src/app/api/documents/[id]/`)

| Agent | Job kind | Notes |
|---|---|---|
| Research Agent | `research` | Chat + Google Search; original names + name remapping workflow |
| Outsiders Perspective | `outsiders` | All authenticated users. Admin gets full 5-dimension analysis (`outsiders_perspective`). Non-admin gets compact brief format (`outsiders_perspective_brief`) — 1–2 bullets per section (Plot & Scene, Dialogue, Hook & Emotion), no scorecard. Route detects `isAdmin` and selects prompt accordingly. |
| Quality Agent | `quality_eval` | One-shot episode eval; Gemini 2.5 Pro + thinking; admin-only |
| Pilot Episode Agent | `pilot_episode` | 3 EP1 variants; plain prose; conversion-first, 3 genuinely different pilots, hook doctrine — **action button only, not triggerable via chat** |
| Storyboard | `visualize` | Admin-only. One image per beat of the latest predefined episode. Two-step: one `gemini-2.5-flash` call generates all N image prompts as JSON (story-communication framing — who/where/emotion/dialogue staging, no cinematography language), then N parallel Imagen 3 calls (16:9). Results in `StoryboardPanel.tsx` right panel (520px). Button visible in editor toolbar when admin + predefined_episodes tab. |

### Known open issues (do not accidentally touch)

- **`suspicious.overwrite` + lost comment highlight — ONE reviewer poll/save race** — ROOT-CAUSED: reviewer poll (`Editor.tsx:895-907`) overwrites editor every 5s with no in-flight guard, racing the 500ms debounced commentMark save. Full report + 4 ranked fixes in `COMMENT-RACE-INVESTIGATION.md`. Report-only — awaiting fix-option decision. Do not modify poll logic in `Editor.tsx` without reading the report.
- **Context cluster (3 symptoms, 1 root cause)** — (1) ~~Skeleton leaks into predefined_episodes chat~~ **FIXED PR #67** — skeleton now excluded from `buildAIContext` when active tab is `predefined_episodes`. (2) ~~Pilot chat intent triggers wrong agent~~ **FIXED PR #67** — pilot is now action-button-only. (3) "This is good, change X" discards finalized output — **still open**. Root cause: stateless AI, no approved/working-copy concept. (3) requires full 3-layer fix; do not patch individually.
- **Plot Chunks button hidden** — in `WorkbookActions.tsx`, intentionally hidden until `PLOT_CHUNKS_SYSTEM_PROMPT` is fixed. Do not unhide.
- **Reference Episode bracket noise** — AI hallucinates scenes when EP plot body < 30 chars. Fix deferred.
- **Chat Bug 6** — chat-prompt over-references active tab on gibberish input. Fix deferred.

## Architecture decisions

### Lazy DB + auth initialization — NEVER REVERT

`src/lib/db/index.ts` exports a Proxy (`db`) that delegates to `getDb()` on first call. `src/lib/auth.ts` creates the NextAuth instance on first HTTP request, not at module eval. Turbopack evaluates all server modules at build time with 9 parallel workers — any top-level `new Database()` or `DrizzleAdapter()` call causes SQLITE_BUSY or build failure.

**Critical**: never pass `db` (the Proxy) to `DrizzleAdapter` — Drizzle's `instanceof` checks fail through a Proxy. Always use `getDb()` for `DrizzleAdapter`.

### Single AI endpoint

All AI modes route through `POST /api/ai/edit`. Mode is a body param. Prompts are read from DB (falls back to code constant). No per-agent endpoints — all differentiation is via `mode` + `jobKind`.

### Structural tag protocol

All AI output uses `[H1]` `[H2]` `[H3]` `[P]` `[OL]` `[UL]` — one tag per line, no markdown, **no closing tags**. `parseTaggedLines()` in `Editor.tsx` converts to Tiptap JSON. AI drift (closing tags like `[/P]`) is stripped in `cleanSearch`, `stripTagsForDisplay`, and pre-processing before `parseTaggedLines`.

### Draft signal protocol

Every draft-mode response starts with `0` (doc content → applied to editor) or `1` (chat → shown in UI) on its own line. `1\n` prefix stripped before display, `0\n` stripped before applying to doc.

### `findAndReplace` strategy order

4 strategies in order: (1) exact text node, (2) block textContent, (3) cross-block concatenation, (4) prefix fallback. **Strategy 3 must run before 4** — a 60-char prefix of a multi-block string always matches the heading alone; running prefix first produces wrong results.

### Feedback apply order

Changes applied in **reverse order** (last-in-doc first) with 50ms delay. Earlier changes shift positions — reverse order prevents drift.

### Prompts: code is source of truth on restart

On every server restart, all prompts are upserted from `prompts.ts` constants. Admin edits in the Prompts panel take effect immediately but are overwritten on next restart. To make a prompt change permanent: edit `prompts.ts`, then deploy.

## What to avoid

- **Never eagerly init DB or NextAuth at module scope** — breaks Docker builds silently.
- **Never use `db` Proxy with `DrizzleAdapter`** — use `getDb()`.
- **Never output or preserve AI closing tags** (`[/P]`, `[/H1]`, etc.) — strip them everywhere.
- **Never use `parseTaggedLines` with `.*` regex** — use `.+` (requires at least one char); empty matches cause silent Tiptap failures.
- **Never commit directly to `main`** — always feature branch → PR.
- **Never run `docker compose restart` after `.env` changes** — must do `down && up -d` to reload env.
- **Never modify the poll logic in `Editor.tsx`** without reading the `suspicious.overwrite` investigation notes in `MEMORY.md`.
- **`tr.insertText` vs `insertContentAt`**: `insertText` for inline (preserves marks), `insertContentAt` for block-level. Never use `replaceWith` with JSON content — causes nesting issues.
- **Schema changes**: always `npx drizzle-kit push` after editing `schema.ts`, then rebuild Docker image.

## Session Files

Read at session start if present: `MEMORY.md` and `ERRORS.md` in this project root.
- `MEMORY.md` — decisions, what was rejected, session summaries
- `ERRORS.md` — failed approaches and what worked instead

Update `MEMORY.md` after significant decisions. Log to `ERRORS.md` after 2+ failed attempts on the same problem.
Session-end trigger ("session end" / "wrapping up" / "let's stop here") → write summary to `MEMORY.md`.
