# AI Native Writer — CLAUDE.md

## What this is

An AI-native scriptwriting tool for a team that writes vertical mobile microdramas. One writer owns a document, others review and comment. Built as a self-hosted Next.js app. Two production deployments: MacMini (Docker + Tailscale) and Ubuntu server (static IP).

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind v4)
- **Tiptap v3** (ProseMirror-based editor, custom extensions)
- **SQLite** via Drizzle ORM + better-sqlite3 (`data/writer.db`)
- **Auth**: NextAuth.js v5 (Google OAuth only — no passwords)
- **AI**: Vercel AI SDK v6 (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/google`)
- **Deployment**: Dockerfile + docker-compose (standalone Next.js build)

## Running locally

```bash
npm run dev   # starts on :3000
```

No Docker needed for local dev. DB is auto-created at `data/writer.db` on first run.

## Key env vars (`.env.local`)

```
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET   # Google OAuth
AUTH_SECRET                                # NextAuth secret
ALLOWED_DOMAIN                             # Optional — restrict login to domain (e.g. company.com)
ADMIN_EMAIL                                # First login with this email gets admin role
ENCRYPTION_KEY                             # 32+ char key for encrypting AI API keys in DB
```

## Database schema (SQLite via Drizzle)

| Table | Purpose |
|---|---|
| `users` | Google OAuth users. `role: admin\|user`, `active: bool` |
| `accounts` / `sessions` / `verification_tokens` | NextAuth managed |
| `documents` | id, title, content (Tiptap JSON), ownerId |
| `comments` | Linked to doc via `commentMarkId` (matches mark in editor), supports threads |
| `document_versions` | Snapshots per doc, throttled 1/5min, max 50, for version history |
| `ai_chat_history` | Per-doc AI chat persistence. `entryType: mode-change\|message` |
| `prompts` | Editable AI prompts (seeded from code on server restart) |
| `ai_settings` | API keys per provider (`id: "anthropic"\|"google"`), AES-256-GCM encrypted |

Schema file: `src/lib/db/schema.ts`. Run `npx drizzle-kit push` after schema changes.

## API routes

```
/api/auth/[...nextauth]          NextAuth Google OAuth
/api/documents                   GET list, POST create
/api/documents/[id]              GET, PUT (owner only), DELETE
/api/documents/[id]/versions     GET version list (owner only)
/api/documents/[id]/versions/revert  POST {versionId}
/api/comments                    GET ?documentId=, POST
/api/comments/[id]               PUT (resolve/update), DELETE
/api/ai/edit                     POST — unified AI endpoint (all modes)
/api/ai/models                   GET — available models based on configured keys
/api/ai/chat-history             GET ?documentId=, POST append entry
/api/prompts                     GET (upserts defaults on first call), PUT (admin)
/api/admin/users                 GET list, PUT [id] (role/active)
/api/admin/documents/[id]/owner  PUT {newOwnerId}
/api/admin/ai-settings           GET configured providers, PUT {provider, apiKey}
```

## AI system (`src/app/api/ai/edit/route.ts`)

Single endpoint handles all AI modes. Reads prompts from DB (falls back to code constants). Uses `result.toTextStreamResponse()` for streaming.

```typescript
POST /api/ai/edit
Body: { messages: [{role, content}][], mode: "edit"|"draft"|"feedback"|"format", modelId?, thinking? }
```

**Prompts** (`src/lib/ai/prompts.ts`) — upserted to DB on server restart from these constants:
- `EDIT_SYSTEM_PROMPT` — select-and-edit with structural tags + document vocabulary
- `DRAFT_SYSTEM_PROMPT` — story creation with 0/1 signal protocol (see below)
- `FEEDBACK_SYSTEM_PROMPT` — full-doc feedback returning `[CHANGE N]` blocks
- `FORMAT_SYSTEM_PROMPT` — restructure document per style guide
- `DOCUMENT_STYLE_GUIDE` — shared style rules appended to all prompts

**AI models** (`src/lib/ai/providers.ts`): Claude Sonnet 4, Gemini 2.5 Flash/Flash Lite/Pro.
Keys stored encrypted in `ai_settings` table. Admin sets via `/admin` → AI Settings tab.

## Structural tag protocol

All AI responses use structural tags for block-level content:
- `[H1]` `[H2]` `[H3]` — headings
- `[OL]` — ordered list item, `[UL]` — unordered list item
- `[P]` — paragraph

AI always outputs ONE tagged line per block. No markdown. The editor parses these back into Tiptap JSON nodes via `parseTaggedLines()` in `Editor.tsx`.

**No closing tags**: AI must never output closing tags like `[/P]`, `[/H1]`, `[/H2]`, etc. The `FEEDBACK_SYSTEM_PROMPT` explicitly forbids them. If they appear anyway (AI drift), they are stripped in `cleanSearch`, `stripTagsForDisplay`, and replacement pre-processing before `parseTaggedLines`.

## Draft mode signal protocol (blank doc)

In draft mode, every AI response starts with `0` or `1` on its own line:
- `0` = document content — sidebar shows "Drafting...", content applied directly to editor
- `1` = conversation — streamed normally to chat UI

The `1\n` prefix is stripped before display. The `0\n` prefix is stripped before applying to doc.

## Editor (`src/components/editor/Editor.tsx`)

Tiptap editor with:
- Extensions: StarterKit, Placeholder, Underline, Highlight (multicolor), TextAlign, Link, CharacterCount, CommentMark, TextStyle, FontFamily, FontSize, Color
- `CommentMark` extension — custom mark with `data-comment-id` attribute for comment highlights
- `EditorHandle` ref — exposes: `scrollToComment`, `removeCommentMark`, `applyCommentMark`, `replaceRange`, `getFullText`, `isEmpty`, `setFullContent`, `findAndReplace`, `highlightSelection`, `removeHighlight`, `scrollToHeading`
- **`replaceRange(taggedAIResponse, originalBlocks, from, to)`** — the AI apply function. For inline (same-block): uses `tr.insertText`. For multi-block: expands selection to block boundaries, calls `insertContentAt` with `parseTaggedLines` output.
- **`findAndReplace(original, replacement)`** — 4-strategy fuzzy search: (1) exact text node match, (2) block textContent match, (3) cross-block concatenation match (window of 30 blocks), (4) prefix fallback (60→15 chars). Strategy 3 must run before strategy 4 — a 60-char prefix of a multi-block search string will always be found in the first single block, producing wrong results.
- **`highlightSelection(from, to, color)`** / **`removeHighlight(from, to)`** — applies/removes Tiptap Highlight mark; uses `wasEditable` guard (same pattern as `applyCommentMark`)
- **`scrollToHeading(pos)`** — sets text selection then calls `domAtPos(pos+1).node.scrollIntoView()`
- `extractTaggedBlocks(state, from, to)` — walks ProseMirror doc, extracts blocks as tagged lines WITH their document positions
- `onHeadingsChange` prop — called on every `transaction` event (rAF-batched) with extracted H1/H2/H3 heading items + positions
- Auto-saves on update (1s debounce). Non-owners can save `commentMarkOnly` changes.
- Polls server every 5s for content changes (non-owners always sync, owners only when no unsaved changes).

## Editor Toolbar (`src/components/editor/EditorToolbar.tsx`)

Owner-only toolbar above the editor. Controls: Font Family select, Font Size select, Font Color select (with color swatch overlay), Heading buttons (H1/H2/H3), Bold, Italic, Underline, Strikethrough, Align (left/center/right), Lists, Link.

**Reactivity**: Subscribes to both `selectionUpdate` AND `transaction` Tiptap events via `useEffect`. Both events are rAF-batched into a single `useReducer` forceUpdate per frame — avoids double re-render per keystroke (both events fire on each keypress). Font family/size/color read directly from `editor.getAttributes("textStyle")` each render. All `isActive` calls are direct `editor.isActive(...)` in render — no cached state.

**Why rAF batching matters**: Without it, each keystroke triggers two React re-renders (one per event). On low-spec Windows browsers this is noticeable. Pattern:
```typescript
const schedule = () => { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(forceUpdate); };
editor.on("selectionUpdate", schedule);
editor.on("transaction", schedule);
```

## Document Outline (`src/components/editor/DocumentOutline.tsx`)

Thin left panel (`w-44`) showing H1/H2/H3 headings as a clickable tree. Auto-hides (returns null) when document has no headings. Indentation: H1 at `pl-3`, H2 at `pl-6`, H3 at `pl-9`. Clicking calls `scrollToHeading(pos)` on the editor ref. Visible to both owner and reviewer. Heading extraction fires only on `transaction` events (content changes), not `selectionUpdate` (cursor moves) — headings don't change from cursor movement.

## AI Chat Sidebar (`src/components/ai/AIChatSidebar.tsx`)

Three modes auto-detected from context:
- **`edit`** — text selected in editor
- **`draft`** — no selection + empty document
- **`feedback`** — no selection + document has content

Key state:
- `messages[]` — current AI conversation context (reset on mode change, NOT rendered directly)
- `history[]` — full display history (persisted to server via `ai_chat_history`, never cleared)
- `streamingText` — current streaming content (separate from `messages` to avoid showing stale content)
- `changes: ParsedChange[]` — parsed `[CHANGE N]` blocks for feedback mode

**Model auto-switching**: On mode change, always switches to Gemini 2.5 Pro. Thinking is enabled ONLY for `draft` mode (first fresh story draft). All other modes (edit, feedback, format) use Gemini 2.5 Pro without thinking. After draft completes, resets to Gemini 2.5 Flash.

**Edit mode**: Selected text is highlighted green (`#bbf7d0`) via `highlightSelection` when AI panel opens. Highlight is removed on Apply, Reject, or panel close. "Apply to document" and "Reject" buttons appear in sticky footer; both clear the highlight.

**Feedback mode**: Apply All / Reject All only — no individual change apply buttons. `handleApplyAllChanges` applies all changes in REVERSE order (later-in-doc first) with 50ms delay between each, then sets `feedbackApplied = true` which hides the change cards. Reverse order is critical: applying earlier changes first shifts document positions, causing later `findAndReplace` calls to target wrong locations.

**Send toggle**: `sendOnEnter` boolean state controls whether Enter or Cmd+Enter sends. Rendered as a centered pill toggle below the send button.

**`ParsedChange` interface**: `{ n: number, original: string, suggested: string }` — no `applied` field. No partial-apply tracking needed since only Apply All is supported.

## Access control

- **Owner**: edit document content, use AI edit, see History, see Prompts
- **Reviewer**: read-only editor, can add/reply to comments (CommentMark applied via temp `setEditable(true)`)
- **Admin**: manage users, transfer doc ownership, set AI keys, edit prompts
- Middleware: cookie-based session check (edge-compatible, no DB)

## Comment system

1. User selects text → clicks "Comment" in BubbleMenu → `handleAddComment` generates `commentMarkId`, calls `onAddComment(markId, quotedText, from, to)` — mark NOT applied yet
2. Comment sidebar shows pending input
3. On submit → `POST /api/comments` → `onApplyCommentMark` calls `editor.applyCommentMark(markId, from, to)`
4. Cancel → no mark applied (no orphan highlight)

Active comment highlighting uses a dynamically injected `<style>` tag (survives Tiptap DOM re-renders). CSS: `comment-highlight` (yellow), `comment-highlight-active` (orange) via `[data-comment-id="xxx"]` selector.

## Version history

Triggered by `PUT /api/documents/[id]`. Before updating, snapshots current content if:
- Content actually changed
- Not a `commentMarkOnly` save
- Latest version is >5 minutes old

Max 50 versions per doc. Owner accesses via "History" button → `VersionHistory` component.

## Prompts panel

Accessible from both homepage and doc header. Dropdown of all 5 prompts. Admins can edit; others read-only. Changes saved to DB immediately; take effect on next AI request. On server restart, all prompts are upserted from code constants (code is source of truth on restart).

## Document style guide (baked into all prompts)

- `[H1]` orange, `[H2]` bold dark, `[H3]` semibold gray, body text dark gray (`#374151`)
- Lists over long paragraphs; H2 for major topic shifts; H3 only for genuine sub-topics
- No blank lines between list items

## Docker deployment

Two production deployments, identical `docker-compose.yml` / `Dockerfile` / `.dockerignore`:

| | MacMini | Ubuntu |
|---|---|---|
| HTTPS | Tailscale (`tailscale serve --bg --https=8446 3020`) | Ngrok static domain (systemd service) |
| Port | 3020 | 3020 |
| Data | External Docker volume `ai-native-writer-db` | Same |
| Auth | Personal Google OAuth | Company Google OAuth |

### Deploy steps (every time)

```bash
# MacBook — zip and ship
zip -r ai-native-writer.zip . -x "node_modules/*" ".next/*" "data/*" ".env.local" ".env"
scp ai-native-writer.zip user@<server-ip>:~/docker/ai-native-writer/

# Server — unzip and rebuild
cd ~/docker/ai-native-writer && unzip -o ai-native-writer.zip && docker compose up -d --build
```

### First-time server setup

```bash
docker volume create ai-native-writer-db
mkdir -p ~/docker/ai-native-writer
# create .env (see env vars below) — use docker env, NOT .env.local
```

### Docker env vars (`.env` on server, NOT `.env.local`)

```
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
AUTH_URL=https://<your-public-domain>
AUTH_SECRET=<openssl rand -base64 32>
ADMIN_EMAIL=
ALLOWED_DOMAIN=          # leave empty = any Google account
ENCRYPTION_KEY=<openssl rand -hex 32>   # must be 32+ hex chars
```

After changing `.env`, must do full `docker compose down && docker compose up -d` — `docker compose restart` does NOT reload env vars.

### User management

No UI to add users — users are created on first Google login. To restrict access set `ALLOWED_DOMAIN`. To deactivate a user, use the Admin → Users panel (set active=false). `ADMIN_EMAIL` gets admin role automatically on first login.

### Google OAuth credentials

One OAuth 2.0 Client ID per deployment. In Google Cloud Console → APIs & Services → Credentials:
- Authorized redirect URI: `https://<your-domain>/api/auth/callback/google`
- Produces: Client ID + Client Secret (these are the same thing — one flow creates both)

## Critical architecture: lazy DB + auth initialization

**Why this matters**: Next.js/Turbopack evaluates all server modules at build time using 9 parallel workers. Any top-level `new Database()` or `DrizzleAdapter()` call during module evaluation causes SQLITE_BUSY or build failures.

**Solution** (already implemented — do not revert):

`src/lib/db/index.ts` — lazy singleton + Proxy:
- `getDb()` — opens SQLite on first call, cached. Safe to call anywhere at runtime.
- `export const db` — a Proxy that delegates to `getDb()`. Turbopack sees a static `export const`. DB never opens during build.
- **Do NOT pass `db` (the Proxy) to `DrizzleAdapter`** — Drizzle's `is()` checks `instanceof` + walks the prototype chain via `entityKind` symbol. A Proxy wrapping `{}` fails this check. Always use `getDb()` for DrizzleAdapter.

`src/lib/auth.ts` — lazy NextAuth initialization:
- `getNextAuth()` — creates NextAuth instance (with `DrizzleAdapter(getDb(), ...)`) on first HTTP request, not at module eval.
- All exports (`handlers`, `auth`, `signIn`, `signOut`) delegate via `lazy()` wrapper.

**Never rewrite these files** to eagerly initialize at module scope — it will break Docker builds.

## Common gotchas

- **Drizzle queries**: always `await`, use `db.query.*` for relational, `db.select()` for joins
- **Tiptap BubbleMenu**: must pass `shouldShow` prop for non-editable editors (reviewers)
- **Prompt DB vs code**: prompts read from DB first, code as fallback. Upserted from code on server restart. Deleting from DB forces fresh seed.
- **`tr.insertText` vs `insertContentAt`**: `insertText` for inline (preserves marks), `insertContentAt` for block-level (uses parsed JSON). Never use `replaceWith` with JSON content — causes nesting issues.
- **Reviewer saves**: `commentMarkOnly: true` in PUT body bypasses owner-only check
- **Schema changes**: always run `npx drizzle-kit push` after editing `schema.ts`, then `npx drizzle-kit generate` to create migration SQL, then rebuild Docker image
- **`ENCRYPTION_KEY`**: must be 32+ chars (use `openssl rand -hex 32` for exactly 64 hex chars). Keys encrypted with AES-256-GCM before storing.
- **Tailscale serve persistence**: always use `--bg` flag: `tailscale serve --bg --https=8446 3020`. Without `--bg` it stops when the terminal closes.
- **`docker compose restart` vs `down/up`**: `restart` does NOT reload `.env` changes. Always use `docker compose down && docker compose up -d` after env changes.
- **AI closing tags**: AI sometimes outputs `[/P]`, `[/H1]`, etc. These must be stripped before display and before inserting into the document. `cleanSearch` in `findAndReplace` strips them; `stripTagsForDisplay` in AIChatSidebar strips them; replacement pre-processing strips them before `parseTaggedLines`. Also split inline tag sequences like `text[/H2][H3]more` by inserting `\n` before each opening tag.
- **`parseTaggedLines` regex**: Use `\s*(.+)` not `\s*(.*)` — the `+` requires at least one content character. Empty matches cause `insertContentAt` to fail silently when Tiptap tries to insert empty text nodes.
- **`findAndReplace` strategy order**: Cross-block (strategy 3) MUST run before prefix fallback (strategy 4). A 60-char prefix of a multi-block original always matches the heading/first block alone — prefix runs first → inserts into heading only, old paragraphs remain → duplication.
- **Toolbar performance**: Subscribe to both `selectionUpdate` AND `transaction` for toolbar reactivity. Use rAF batching to collapse both into one re-render per frame. Do NOT use `useEditorState` — it only subscribes to `transaction`, missing cursor-move updates.
