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

## Draft mode signal protocol (blank doc)

In draft mode, every AI response starts with `0` or `1` on its own line:
- `0` = document content — sidebar shows "Drafting...", content applied directly to editor
- `1` = conversation — streamed normally to chat UI

The `1\n` prefix is stripped before display. The `0\n` prefix is stripped before applying to doc.

## Editor (`src/components/editor/Editor.tsx`)

Tiptap editor with:
- `CommentMark` extension — custom mark with `data-comment-id` attribute for comment highlights
- `EditorHandle` ref — exposes: `scrollToComment`, `removeCommentMark`, `applyCommentMark`, `replaceRange`, `getFullText`, `isEmpty`, `setFullContent`, `findAndReplace`
- **`replaceRange(taggedAIResponse, originalBlocks, from, to)`** — the AI apply function. For inline (same-block): uses `tr.insertText`. For multi-block: expands selection to block boundaries, calls `insertContentAt` with `parseTaggedLines` output.
- `extractTaggedBlocks(state, from, to)` — walks ProseMirror doc, extracts blocks as tagged lines WITH their document positions
- Auto-saves on update (1s debounce). Non-owners can save `commentMarkOnly` changes.
- Polls server every 5s for content changes (non-owners always sync, owners only when no unsaved changes).

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

**Model auto-switching**: draft and feedback modes auto-enable Gemini 2.5 Pro + Thinking. Resets to Gemini 2.5 Flash after draft completes.

**Apply flow for feedback**: `handleApplyAllChanges` applies changes one at a time with 50ms delay (lets Tiptap update state between each). `findAndReplace` uses 3-strategy fuzzy search.

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

## Common gotchas

- **Drizzle queries**: always `await`, use `db.query.*` for relational, `db.select()` for joins
- **Tiptap BubbleMenu**: must pass `shouldShow` prop for non-editable editors (reviewers)
- **Prompt DB vs code**: prompts read from DB first, code as fallback. Upserted from code on server restart. Deleting from DB forces fresh seed.
- **`tr.insertText` vs `insertContentAt`**: `insertText` for inline (preserves marks), `insertContentAt` for block-level (uses parsed JSON). Never use `replaceWith` with JSON content — causes nesting issues.
- **Reviewer saves**: `commentMarkOnly: true` in PUT body bypasses owner-only check
- **Schema changes**: always run `npx drizzle-kit push` after editing `schema.ts`
- **`ENCRYPTION_KEY`**: must be 32+ chars. Keys encrypted with AES-256-GCM before storing.
