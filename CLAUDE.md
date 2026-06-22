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
| `src/lib/ai/prompts.ts` | All 24 prompt constants — source of truth on server restart; upserted to DB |
| `src/app/api/prompts/route.ts` | Prompt DB seeding — registers all prompt IDs in DEFAULTS |
| `src/components/ai/AIChatSidebar.tsx` | Chat sidebar — mode detection, streaming, signal protocol, change parsing |
| `src/components/editor/Editor.tsx` | Tiptap editor — `replaceRange`, `findAndReplace`, `highlightSelection`, `CommentMark` |
| `src/components/editor/WorkbookActions.tsx` | Workbook tab action buttons — triggers agent job kinds |
| `src/lib/db/index.ts` | Lazy DB singleton + Proxy — **do not rewrite** (see Architecture) |
| `src/lib/auth.ts` | Lazy NextAuth init — **do not rewrite** (see Architecture) |
| `src/lib/db/schema.ts` | Drizzle schema — run `npx drizzle-kit push` after changes |

## Active Work

- **Prod URL**: https://ai-native-writer-936494534526.asia-south1.run.app/
- **Latest shipped**: PR #65 — predefined episode prompt improvements (merged 15 Jun 2026)
- **Total prompts in DB**: 24 (seeded from `prompts.ts` on restart)
- **Cloud Run config**: `max-instances=1` (SQLite single-writer), `concurrency=50` (bumped 22 Jun 2026 from 20 — 429s under multi-user load)

### Predefined Episode Format (as of PR #65 — 15 Jun 2026)

`CANONICAL_REF_EPISODE_FORMAT` and `NEXT_REFERENCE_EPISODE_SYSTEM_PROMPT` were significantly updated. Key format changes writers and downstream systems must know:

- **Seq N headers**: every scene change opens with `[P] Seq N — Location | Time of day | Characters present`
- **`[tone]` tags**: required on every TYPE B dialogue line and TYPE C V.O. line — `"line" [tone]`
- **Quotes mandatory**: all spoken dialogue in double quotes — without them batch_gen cannot extract lines
- **Spatial framework**: scene-opening Visual beats encode GEOGRAPHY / FORCES / STATE ARC
- **V.O. required**: when a character receives a revelation they cannot voice aloud — not optional
- **Pre-emit checks**: PREPARED ANSWER (physical beat before verbal response), SILENCE (devastating moment must freeze first), V.O., QUOTES — run on draft before emitting

### Pending (NOT pushed)

- **Branch `fix/pilot-routing-and-comment-bugs`** (commit `98c3a5d`, build passed): pilot button routing fix (Research Agent now splits `## Characters` to correct tab) + `PILOT_EPISODE_SYSTEM_PROMPT` rewrite. Comment race (#2/#3) investigated, report-only. Push + PR to `main` pending.

### AI Agents (all in `src/components/ai/` + `src/app/api/documents/[id]/`)

| Agent | Job kind | Notes |
|---|---|---|
| Research Agent | `research` | Chat + Google Search; original names + name remapping workflow |
| Outsiders Perspective | `outsiders` | Admin-only episode analyzer; emotion/relationship velocity audits |
| Quality Agent | `quality_eval` | One-shot episode eval; Gemini 2.5 Pro + thinking; admin-only |
| Pilot Episode Agent | `pilot_episode` | 3 EP1 variants in chat; plain prose; conversion-first, 3 genuinely different pilots, hook doctrine (unpushed rewrite in `fix/pilot-routing-and-comment-bugs`) |

### Known open issues (do not accidentally touch)

- **`suspicious.overwrite` + lost comment highlight — ONE reviewer poll/save race** — ROOT-CAUSED: reviewer poll (`Editor.tsx:895-907`) overwrites editor every 5s with no in-flight guard, racing the 500ms debounced commentMark save. Full report + 4 ranked fixes in `COMMENT-RACE-INVESTIGATION.md`. Report-only — awaiting fix-option decision. Do not modify poll logic in `Editor.tsx` without reading the report.
- **Context cluster (3 symptoms, 1 root cause)** — do not patch individually: (1) Skeleton grabs all tab context regardless of conversation. (2) Chat context triggers wrong agent. (3) "This is good, change X" discards finalized output. Root cause: every AI call is stateless, no concept of approved/working-copy state. Fix requires 3 layers. RCA dive needed before any code changes.
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
