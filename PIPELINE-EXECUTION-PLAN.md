# Multi-Step Episode Pipeline — Execution Plan
**Date:** 2026-07-20
**Branch to create:** `feat/multi-step-episode-pipeline`
**Based on:** Feature spec v1.1 at `D:\plotpix\FEATURES\feat-multi-step-episode-pipeline.md`
**Status:** Ready to execute. Nothing coded yet.

---

## What this builds

A four-step, writer-driven pipeline that replaces the broken Series Skeleton → Plots flow. The writer drives each step; AI drafts into chat; writer transfers drafts to the Workbook, edits, then manually moves the final version into that step's locked tab. Filling a tab unlocks the next step's button.

```
[Build World]        → chat draft → refine → workbook → World State tab  ──┐
[Suggest Beats]      (unlocks when World State filled)  → Beats tab  ───────┤
[Connect the Story]  (unlocks when Beats filled)        → Story Logic tab ──┤
[Write Plots]        (unlocks when Story Logic filled)  → Plots tab  ───────┘
```

Output of Step 4 (Plots tab = `microdrama_plots`) feeds the existing, unchanged downstream: Plot → Predefined Episode.

---

## Ground rules for the executor

1. Follow existing patterns — for every new piece, read the nearest equivalent first and mirror its shape.
2. Touch only files in the file list. If a change seems to require something outside it, stop and report.
3. Run `npm run build` after every numbered step. Do not proceed on a broken build.
4. No DB migration. `tabs.type` is a plain text column (`schema.ts:87`). If you find yourself editing `schema.ts`, stop.
5. Never commit to `main` — feature branch only, PR at the end.
6. AI tag format: `[H1] [H2] [H3] [P] [OL] [UL]` — one per line, no closing tags.

---

## Step 1 — Confirm assumptions (read-only, no code)

**Goal:** verify two assumptions the plan depends on before writing a line.

### 1a. Confirm `tabs.type` is a plain text column
- Read `src/lib/db/schema.ts` around line 87.
- Expect: `type: text("type")` with no CHECK constraint or enum.
- If it has a CHECK enum: stop, report — adding new types would require a migration.

### 1b. Confirm pilots live in predefined Episode 1
- Open a live doc that has a pilot written.
- Check whether the pilot lives under `predefined_episodes` tab as the first `[H3] Episode 1` section (the way `splitTabByH3` + `extractEpisodeNumber` would find it).
- If pilots live somewhere else (separate tab, different structure): stop, report — Step 5's "Build World reads Pilot" context logic depends on this.

**Accept criteria:** both confirmed. No code written.

---

## Step 2 — Tabs foundation

**Goal:** register the 3 new canonical tabs so they appear in new docs and are recognized by the type system. All 5 edits must happen together — skipping `tab-heal.ts` causes new tabs to be misclassified as "custom" and reshuffled to the end.

### 2a. `src/lib/canonical-tabs.ts`

**What to read first:** the existing `CanonicalTabType` union (`:12-18`) and `CANONICAL_TABS` array (`:59-103`). Mirror the shape of the Characters or Series Skeleton entries exactly.

**Changes:**

Extend `CanonicalTabType`:
```typescript
export type CanonicalTabType =
  | "series_overview"
  | "characters"
  | "series_skeleton"
  | "microdrama_plots"
  | "predefined_episodes"
  | "workbook"
  | "world_state"       // NEW
  | "beat_sequence"     // NEW
  | "story_logic";      // NEW
```

Add 3 entries to `CANONICAL_TABS` after the `workbook` entry at position 5:
```typescript
{
  type: "world_state",
  title: "World State",
  position: 6,
  content: doc([h1("World State")]),
},
{
  type: "beat_sequence",
  title: "Beats",
  position: 7,
  content: doc([h1("Beats")]),
},
{
  type: "story_logic",
  title: "Story Logic",
  position: 8,
  content: doc([h1("Story Logic")]),
},
```

Note: `buildCanonicalTabRows` loops over `CANONICAL_TABS` and sets `isProtected: true` on every entry. No change needed to that function — the new tabs inherit protection automatically.

### 2b. `src/lib/tab-heal.ts`

**What to read first:** `classify()` function (`:49-61`). It returns a `CanonicalTabType | "research_legacy" | "archive" | "custom"`. Add 3 `if` returns before the final `return "custom"` fallback.

**Change:** add inside `classify()`:
```typescript
if (t === "world_state") return "world_state";
if (t === "beat_sequence") return "beat_sequence";
if (t === "story_logic") return "story_logic";
```

Without this, `healFixedTabs` treats these types as "custom" and re-numbers them to trailing positions. The function is not called on the per-GET path (heal was removed for perf), but it IS called by the admin backfill route in step 2e.

Also update the comment at the top of the file: change "six canonical protected tabs" to "nine canonical protected tabs" and update the parenthetical list to include the 3 new ones.

### 2c. `src/components/editor/TabRail.tsx`

**What to read first:** `TabType` union (`:5-18`) and `TYPE_BADGES` record (`:31-61`). `TYPE_BADGES` is typed as `Record<TabType, …>` so TypeScript will force-error if you add a value to `TabType` without a corresponding badge entry.

**Changes:**

Add to `TabType`:
```typescript
| "world_state"
| "beat_sequence"
| "story_logic"
```

Add to `TYPE_BADGES`:
```typescript
world_state: {
  label: "World State",
  className: "bg-violet-100 text-violet-700",
},
beat_sequence: {
  label: "Beats",
  className: "bg-orange-100 text-orange-700",
},
story_logic: {
  label: "Story Logic",
  className: "bg-cyan-100 text-cyan-700",
},
```

Color choices above are suggestions — pick any unused color pair that reads well. The TypeScript error will surface immediately if `TYPE_BADGES` is missing an entry.

### 2d. `src/app/api/documents/[id]/tabs/route.ts`

**What to read first:** `VALID_TYPES` array (`:10-21`). This is the POST whitelist — canonical seeding bypasses POST (direct DB insert), but keep the list honest.

**Change:** add to `VALID_TYPES`:
```typescript
"world_state",
"beat_sequence",
"story_logic",
```

### 2e. New file: `src/app/api/admin/backfill-pipeline-tabs/route.ts`

**What to read first:**
- `src/app/api/admin/prune-versions/route.ts` — same admin auth gate (`session?.user?.role !== "admin"` → 403), same one-shot pattern. Mirror it exactly.
- `healFixedTabs(docId)` in `src/lib/tab-heal.ts:142` — **this already does the insert.**

**Purpose:** insert the 3 new canonical tabs into any existing doc that doesn't have them yet. Run once manually after deploy. Never wired into any load path.

**Do NOT hand-write an insert loop — reuse `healFixedTabs`.** Once Steps 2a/2b land, `healFixedTabs` already: (a) recognises the 3 new types via `classify()`; (b) sees them missing — its early-return at `tab-heal.ts:150-157` now requires all 9 canonical specs, so a 6-tab doc falls through instead of short-circuiting; (c) inserts exactly the missing tabs with `isProtected: true` and correct content; (d) renumbers trailing archive/custom tabs. It is idempotent — safe to run twice. Reinventing the insert loop duplicates tested logic (ground rule #1).

**Logic:**
1. Admin-only gate: `if (session?.user?.role !== "admin") return 403`.
2. Fetch all document IDs from the `documents` table.
3. For each `docId`: `const changed = await healFixedTabs(docId);` — accumulate a count.
4. Return `{ ok: true, docsProcessed: N, docsChanged: M }`.

**Debug logs (this file):**
```typescript
logTrace("backfill.pipeline_tabs.doc", { docId, changed });      // per doc
logEvent("backfill.pipeline_tabs.done", { docsProcessed, docsChanged }); // at end
```
`healFixedTabs` itself already emits `tabs.heal.seed_fixed { docId, tabId, type }` for every tab it inserts — grep that in Cloud Run logs to see exactly which tabs were added to which docs.

**Why a route, not heal-on-load:** heal-on-load was removed from the GET path for perf (single SQLite instance — per-GET writes were the regression we just fixed). This route calls the same `healFixedTabs`, but once, off the hot path, on demand.

**Accept criteria for Step 2:**
- Create a new doc → it shows 9 canonical tabs: Original Research, Characters, Series Skeleton, Microdrama Plots, Predefined Episodes, Workbook, World State, Beats, Story Logic.
- World State, Beats, Story Logic each show their correct badge color.
- `npm run build` passes clean.
- (Backfill route tested after deploy in Step 9, not locally.)

---

## Step 3 — Controlled context builder + route wiring

**Goal:** wire the pipeline step IDs into the route and add the context builder that enforces the SENDS/EXCLUDES contract per step. Use stub prompts (echo stubs) so the dilution gate can be tested before writing real prompts.

### 3a. `src/lib/ai/prompts.ts` — stub prompt constants

Add 4 new exported constants at the end of the file:

```typescript
export const WORLD_STATE_SYSTEM_PROMPT = `[STUB — World State] You are a pipeline step. Echo back the context you received, prefixed with "WORLD STATE CONTEXT RECEIVED:". Do not generate any real content.`;

export const BEAT_GEN_SYSTEM_PROMPT = `[STUB — Beat Generator] You are a pipeline step. Echo back the context you received, prefixed with "BEAT GEN CONTEXT RECEIVED:". Do not generate any real content.`;

export const CAUSALITY_SYSTEM_PROMPT = `[STUB — Causality Resolver] You are a pipeline step. Echo back the context you received, prefixed with "CAUSALITY CONTEXT RECEIVED:". Do not generate any real content.`;

export const PLOT_SYNTH_SYSTEM_PROMPT = `[STUB — Plot Synthesizer] You are a pipeline step. Echo back the context you received, prefixed with "PLOT SYNTH CONTEXT RECEIVED:". Do not generate any real content.`;
```

These stubs are replaced in Steps 5–8 with real prompts. They exist here so the route can reference them as fallbacks.

### 3b. `src/lib/ai/seed-prompts.ts` — register with prompt DB

**What to read first:** the existing import block (`:19-47`) and `DEFAULTS` array (`:49-77`). Mirror the entry shape exactly.

**Changes:**

Add to imports:
```typescript
  WORLD_STATE_SYSTEM_PROMPT,
  BEAT_GEN_SYSTEM_PROMPT,
  CAUSALITY_SYSTEM_PROMPT,
  PLOT_SYNTH_SYSTEM_PROMPT,
```

Add to `DEFAULTS`:
```typescript
{ id: "pipe_world_state", label: "Pipeline: Build World", content: WORLD_STATE_SYSTEM_PROMPT },
{ id: "pipe_beat_gen",    label: "Pipeline: Suggest Beats", content: BEAT_GEN_SYSTEM_PROMPT },
{ id: "pipe_causality",   label: "Pipeline: Connect the Story", content: CAUSALITY_SYSTEM_PROMPT },
{ id: "pipe_plot_synth",  label: "Pipeline: Write Plots", content: PLOT_SYNTH_SYSTEM_PROMPT },
```

On next server restart, `seedPromptsFromCode()` upserts these into the DB. The route's `getSystemPrompt` then finds them by ID.

### 3c. `src/app/api/ai/edit/route.ts` — extend Mode + FALLBACK_PROMPTS

**What to read first:** `Mode` type (`:15`) and `FALLBACK_PROMPTS` (`:17-23`). The type is a string union; `FALLBACK_PROMPTS` is a `Record<Mode, string>`.

**Changes:**

Add to imports:
```typescript
  WORLD_STATE_SYSTEM_PROMPT,
  BEAT_GEN_SYSTEM_PROMPT,
  CAUSALITY_SYSTEM_PROMPT,
  PLOT_SYNTH_SYSTEM_PROMPT,
```

Extend `Mode`:
```typescript
type Mode =
  | "edit" | "draft" | "feedback" | "format" | "chat"
  | "pipe_world_state" | "pipe_beat_gen" | "pipe_causality" | "pipe_plot_synth";
```

Add to `FALLBACK_PROMPTS`:
```typescript
pipe_world_state: WORLD_STATE_SYSTEM_PROMPT,
pipe_beat_gen:    BEAT_GEN_SYSTEM_PROMPT,
pipe_causality:   CAUSALITY_SYSTEM_PROMPT,
pipe_plot_synth:  PLOT_SYNTH_SYSTEM_PROMPT,
```

The route's `getSystemPrompt` already does DB lookup → code fallback, and `streamText` is unchanged.

**Add a debug log to `getSystemPrompt` — this is the single most useful log for the whole feature:**
```typescript
async function getSystemPrompt(mode: Mode): Promise<string> {
  const row = await db.query.prompts.findFirst({ where: eq(prompts.id, mode) });
  const source = row?.content ? "db" : "fallback";
  logTrace("ai.edit.prompt_resolved", { mode, source });
  return row?.content || FALLBACK_PROMPTS[mode];
}
```
It tells you two things at once: **(a)** which `mode` actually reached the server — if a pipeline button logs `mode: "chat"` instead of `mode: "pipe_world_state"`, the stale-closure bug (Step 4.5) is present; **(b)** whether the pipeline prompt was found in the DB (`source: "db"`) or fell back to the code stub (`source: "fallback"` = the seed didn't run / server wasn't restarted after Step 3b). Add `import { logTrace } from "@/lib/saveTrace";` to this route.

### 3d. `src/lib/ai/context-engine.ts` — add `buildPipelineStepContext`

**What to read first:**
- `tiptapJsonToTagged` (`:61-98`) — use this to render any tab's content to tagged text.
- `findTabByType` (`:102-111`) — module-private; it's in this file, so it's accessible.
- `splitTabByH3` (`:145-177`) — splits a tagged string into sections at every `[H3]` boundary.
- `extractEpisodeNumber` (`:206-209`) — parses episode number from an `[H3]` heading.
- `buildAIContext` (`:227-377`) — do NOT reuse this for pipeline steps. It produces the broad context; pipeline steps need the minimal controlled context.

**Function to add** (add after the exports, before or after `buildAIContext`):

```typescript
// ─── Pipeline Step Context Builder ───
//
// Produces a minimal, step-specific context string for the Multi-Step
// Episode Pipeline. Each step has a fixed SENDS/EXCLUDES contract.
// Never calls buildAIContext — the dilution guard is intentional.
//
// SENDS per step:
//   pipe_world_state  → series_overview, characters, predefined_episodes (Ep1 only),
//                       beat_sequence (prior locked batches), workbook (if non-empty)
//   pipe_beat_gen     → world_state, workbook (if non-empty)
//   pipe_causality    → beat_sequence, world_state, workbook (if non-empty)
//   pipe_plot_synth   → story_logic, world_state, characters, workbook (if non-empty)

type PipelineStepId =
  | "pipe_world_state"
  | "pipe_beat_gen"
  | "pipe_causality"
  | "pipe_plot_synth";

export function buildPipelineStepContext(
  stepId: PipelineStepId,
  tabs: TabRow[],
  workbookLiveContent: string | null
): string {
  const parts: string[] = [];

  const render = (tab: TabRow | undefined, label: string): string => {
    if (!tab) return "";
    const tagged = tiptapJsonToTagged(tab.content);
    if (!tagged.trim()) return "";
    return `=== ${label} ===\n${tagged}`;
  };

  const tab = (type: string) => findTabByType(tabs, type);

  // Workbook draft (included when non-empty, labeled so model knows it's a draft)
  const workbookContent = workbookLiveContent ?? tab("workbook")?.content ?? null;
  const workbookTagged = tiptapJsonToTagged(workbookContent);
  const hasWorkbook = workbookTagged.trim().length > 0;

  if (stepId === "pipe_world_state") {
    // Research + OG story from series_overview
    const overview = render(tab("series_overview"), "Original Research");
    if (overview) parts.push(overview);

    // Characters
    const chars = render(tab("characters"), "Characters");
    if (chars) parts.push(chars);

    // Pilot = predefined Episode 1 only
    const predefined = tab("predefined_episodes");
    if (predefined) {
      const allTagged = tiptapJsonToTagged(predefined.content);
      const sections = splitTabByH3(allTagged);
      const ep1 = sections.find(
        (s) => extractEpisodeNumber(s.heading) === 1
      );
      if (ep1) {
        parts.push(
          `=== Pilot (Predefined Episode 1) ===\n[H3] ${ep1.heading}\n${ep1.body}`
        );
      }
    }

    // Prior locked beat batches from beat_sequence tab
    const beats = tab("beat_sequence");
    if (beats) {
      const beatsTagged = tiptapJsonToTagged(beats.content);
      if (beatsTagged.trim()) {
        parts.push(`=== Prior Locked Beats ===\n${beatsTagged}`);
      }
    }
  }

  if (stepId === "pipe_beat_gen") {
    const ws = render(tab("world_state"), "World State");
    if (ws) parts.push(ws);
  }

  if (stepId === "pipe_causality") {
    const ws = render(tab("world_state"), "World State");
    if (ws) parts.push(ws);
    const beats = render(tab("beat_sequence"), "Beats");
    if (beats) parts.push(beats);
  }

  if (stepId === "pipe_plot_synth") {
    const ws = render(tab("world_state"), "World State");
    if (ws) parts.push(ws);
    const chars = render(tab("characters"), "Characters");
    if (chars) parts.push(chars);
    const sl = render(tab("story_logic"), "Story Logic");
    if (sl) parts.push(sl);
  }

  // Workbook draft — included by all steps when non-empty
  if (hasWorkbook) {
    parts.push(`=== Current Working Draft (Workbook) ===\n${workbookTagged}`);
  }

  const out = parts.join("\n\n");

  // Debug — surfaces exactly what each step SENDS. This IS the dilution gate,
  // made visible. `sections` lists the "=== Label ===" header of every block.
  // For pipe_beat_gen it must show ONLY "World State" (+ "Current Working
  // Draft" if the workbook has content). Anything else = the contract leaked.
  if (typeof window !== "undefined") {
    console.debug("[pipeline:context]", {
      stepId,
      sections: parts.map((p) => p.split("\n")[0]),
      totalChars: out.length,
      hasWorkbook,
    });
  }

  return out;
}
```

**Accept criteria for Step 3:**
- `npm run build` passes clean.
- (Dilution gate verified in Step 4 after UI is wired.)

---

## Step 4 — UI: step buttons + gating

**Goal:** wire the 4 step buttons into `AIChatSidebar`, make `mode` dynamic, implement gating.

### What the writer sees (read this first — no new screen)

Everything lands **inside the AI Assistant panel** — the chat sidebar on the right of the editor (the one headed "AI Assistant"). No new page, no modal, no wizard. Today that panel looks like this, top to bottom:

```
┌─ AI Assistant ───────── Format 🗑 ✕ ─┐   header
│ (Workbook action buttons)             │   ← only shown on the Workbook tab
├───────────────────────────────────────┤
│                                       │
│   chat messages                       │   ← scrollable thread
│                                       │
├───────────────────────────────────────┤
│ [ type a prompt…             ] [Send] │   ← input box
└───────────────────────────────────────┘
```

This feature adds **one new block** — a small "Episode Pipeline" section with four stacked buttons — directly under the header, in the same zone the Workbook actions already live:

```
┌─ AI Assistant ───────── Format 🗑 ✕ ─┐
│ EPISODE PIPELINE            Exit step │   ← "Exit step" appears only mid-step
│  ┌─────────────────────────────────┐  │
│  │ Build World                     │  │  ← blue  = enabled / clickable
│  ├─────────────────────────────────┤  │
│  │ Suggest Beats                   │  │  ← grey  = locked until the
│  ├─────────────────────────────────┤  │     previous step's tab is filled
│  │ Connect the Story               │  │
│  ├─────────────────────────────────┤  │
│  │ Write Plots                     │  │
│  └─────────────────────────────────┘  │
├───────────────────────────────────────┤
│   chat messages (AI drafts appear     │
│   here; refine by typing follow-ups)  │
├───────────────────────────────────────┤
│ [ type a prompt…             ] [Send] │
└───────────────────────────────────────┘
```

**How the writer uses it:**
1. Click **Build World**. The AI drafts a World State straight into the chat thread. Refine it by typing follow-ups in the same box (normal chat).
2. Copy the final draft into the Workbook, edit it, then paste it into the **World State** tab (left tab rail).
3. Filling the World State tab flips **Suggest Beats** from grey to blue. Repeat down the four steps; each filled tab unlocks the next button.
4. **Exit step** (top-right of the section) returns to plain chat — the buttons stay visible, but typing now talks to normal chat mode again.

The four buttons are just shortcuts: each one pre-loads the correct context + system prompt for that step. Same chat box, driven by a button instead of a typed instruction.

**What to read first:**
- The hardcoded `const mode: Mode = "chat"` at `:137`.
- The `sendMessages` closure at `:414-501` — it captures `mode` in its closure deps at `:500`.
- The POST body at `:428-433` — sends `{ messages, mode, modelId, thinking }`.
- The intent routing block at `:503-539` (skeleton + ref-ep detection) — pipeline buttons bypass this entirely (they call `sendMessages` directly, not via `handleSubmit`).

**Changes to `src/components/ai/AIChatSidebar.tsx`:**

**1. Extend the local `Mode` type:**
```typescript
type Mode =
  | "edit" | "draft" | "feedback" | "format" | "chat"
  | "pipe_world_state" | "pipe_beat_gen" | "pipe_causality" | "pipe_plot_synth";
```

**2. Add imports:**
```typescript
import { buildPipelineStepContext } from "@/lib/ai/context-engine";
```
Add `PipelineStepId` if needed (or just use the string literals inline — match whichever approach is simpler).

**3. Add state and registry** (after the existing `const mode: Mode = "chat"` line — replace the const with the dynamic version):

```typescript
type PipelineStepId =
  | "pipe_world_state"
  | "pipe_beat_gen"
  | "pipe_causality"
  | "pipe_plot_synth";

const PIPELINE_STEPS: {
  id: PipelineStepId;
  label: string;
  gateTabType: string | null; // null = always enabled (Build World only needs series_overview)
  enabledWhenTabType: string; // tab that must be non-empty to unlock this step
}[] = [
  {
    id: "pipe_world_state",
    label: "Build World",
    gateTabType: null,
    enabledWhenTabType: "series_overview", // enabled when research exists
  },
  {
    id: "pipe_beat_gen",
    label: "Suggest Beats",
    gateTabType: null,
    enabledWhenTabType: "world_state",
  },
  {
    id: "pipe_causality",
    label: "Connect the Story",
    gateTabType: null,
    enabledWhenTabType: "beat_sequence",
  },
  {
    id: "pipe_plot_synth",
    label: "Write Plots",
    gateTabType: null,
    enabledWhenTabType: "story_logic",
  },
];

const [activeStep, setActiveStep] = useState<PipelineStepId | null>(null);
```

**4. Replace the hardcoded mode (used by the manual-typing path only):**
```typescript
// Was: const mode: Mode = "chat";
const mode: Mode = activeStep ?? "chat";
```

**5. ⚠️ Fix the stale-closure trap — patch `sendMessages` to take an explicit mode.**

`sendMessages` (`:414-501`) reads `mode` from its own closure and writes it into the POST body (`:430`) and the history entry (`:482`). Its deps are `[mode, modelId, thinking]`, so a NEW `mode` only reaches the function on the NEXT render. But `handleStepClick` (point 7) calls `setActiveStep(stepId)` and then `await sendMessages(...)` **in the same tick** — at that moment `sendMessages` still carries the OLD `mode` (`"chat"`). Result: the step's first, auto-fired message is sent as `mode: "chat"`, `getSystemPrompt("chat")` runs, the pipeline prompt never fires, and the dilution guard silently does nothing.

Do NOT rely on the derived-state closure "catching up." Pass the mode explicitly:

```typescript
const sendMessages = useCallback(
  async (
    msgs: ChatMessage[],
    opts: { selectionAtSubmit: boolean; originTabId: string; modeOverride?: Mode }
  ) => {
    const { selectionAtSubmit, originTabId, modeOverride } = opts;
    const effectiveMode: Mode = modeOverride ?? mode;   // explicit override wins

    // Debug — the mode that actually goes on the wire. Pair this with the
    // server-side ai.edit.prompt_resolved log to prove the pick arrived.
    console.debug("[pipeline:send]", { effectiveMode, override: modeOverride ?? null });

    // ... unchanged setup ...
    body: JSON.stringify({
      messages: msgs,
      mode: effectiveMode,   // was: mode
      modelId,
      thinking,
    }),
    // ... and where the assistant HistoryEntry is built (:482), use effectiveMode ...
  },
  [mode, modelId, thinking]
);
```
Every read of `mode` **inside** `sendMessages` (POST body at `:430`, `HistoryEntry.mode` at `:482`) must become `effectiveMode`. `handleSubmit`'s existing calls pass no `modeOverride`, so they keep using `mode` — behaviour unchanged for the typed-prompt path.

**6. Add a helper to check if a step's gate tab is non-empty:**
```typescript
const isTabNonEmpty = useCallback((tabType: string): boolean => {
  const t = tabs.find((tab) => tab.type === tabType);
  if (!t?.content) return false;
  const tagged = tiptapJsonToTagged(t.content);
  return tagged.trim().length > 0;
}, [tabs]);
```

> **v1 gating decision (locked):** the gate is **any non-empty content** in the destination tab — that alone unlocks the next step. Copy-paste into the tab is the handoff; no auto-advance. A stricter gate that validates the *required headings are present* in the pasted content (e.g. World State must contain `[H2] Current State`, `[H2] Series-End Destination`, `[H2] Character Map`) is **preferred but deferred to v2** — do NOT build it now. Keep `isTabNonEmpty` as-is for v1.

**7. Add a handler for step button click:**
```typescript
const handleStepClick = useCallback(
  async (stepId: PipelineStepId) => {
    if (isStreaming || isAIBusy) return;
    setActiveStep(stepId);
    setMessages([]); // fresh conversation for each step activation

    // Build controlled context — passes live workbook content if the
    // workbook is the active tab (writer may have unsaved edits)
    const liveWorkbookContent =
      activeTab.type === "workbook"
        ? (editorRef.current?.getContent?.() ?? null)
        : null;

    const context = buildPipelineStepContext(stepId, tabs, liveWorkbookContent);

    // Debug — confirm the pick reached this handler and produced context.
    console.debug("[pipeline:step]", {
      stepId,
      activeTabType: activeTab.type,
      usedLiveWorkbook: liveWorkbookContent !== null,
      contextChars: context.length,
    });

    // First user turn = the controlled context block
    const initialMessage: ChatMessage = {
      role: "user",
      content: context || "(no context available for this step yet)",
    };
    setMessages([
      initialMessage,
      { role: "assistant", content: "" }, // placeholder for streaming
    ]);

    await sendMessages([initialMessage], {
      selectionAtSubmit: false,
      originTabId: activeTab.id,
      modeOverride: stepId,   // ← explicit; do NOT depend on the `mode` closure
    });
  },
  [isStreaming, isAIBusy, activeTab, editorRef, tabs, sendMessages]
);
```

**8. Add "Exit step" handler:**
```typescript
const handleExitStep = useCallback(() => {
  setActiveStep(null);
  setMessages([]);
}, []);
```

**9. Render the pipeline section in the sidebar JSX:**

Find an appropriate place in the JSX (e.g., above or below the WorkbookActions panel, or in a dedicated collapsible section). Add:

```tsx
{/* ─── Multi-Step Episode Pipeline ─── */}
<div className="border-t border-gray-200 px-3 py-2">
  <div className="flex items-center justify-between mb-1.5">
    <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
      Episode Pipeline
    </span>
    {activeStep && (
      <button
        type="button"
        onClick={handleExitStep}
        className="text-[11px] text-indigo-500 hover:text-indigo-700"
      >
        Exit step
      </button>
    )}
  </div>
  <div className="flex flex-col gap-1">
    {PIPELINE_STEPS.map((step) => {
      const enabled = isTabNonEmpty(step.enabledWhenTabType) && !isStreaming && !isAIBusy;
      const isActive = activeStep === step.id;
      return (
        <button
          key={step.id}
          type="button"
          onClick={() => handleStepClick(step.id)}
          disabled={!enabled}
          className={`w-full rounded px-2 py-1.5 text-left text-[12px] font-medium transition-colors
            ${isActive
              ? "bg-indigo-600 text-white"
              : enabled
              ? "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
        >
          {step.label}
        </button>
      );
    })}
  </div>
</div>
```

**Accept criteria for Step 4:**
- Build World button enabled when Original Research has content; disabled when empty.
- Suggest Beats disabled until World State tab has content; etc.
- Clicking a step button fires a request, streams a response into the chat thread.
- With stub prompts: the chat shows the echoed context — verify only the contracted inputs appear (no skeleton, no all-plots dump appearing in Suggest Beats, etc.). This is the dilution gate.
- **Mode verification (catches the closure bug):** click a step, then in the browser console confirm `[pipeline:send].effectiveMode` equals the stepId (e.g. `pipe_beat_gen`, NOT `chat`), and in the server log confirm `ai.edit.prompt_resolved { mode: "pipe_beat_gen", source: "db" }`. If either shows `chat`, point 5 was not applied correctly.
- Exit step clears `activeStep`; subsequent chat input uses `mode = "chat"` again.
- `npm run build` clean.

---

## Step 5 — Build World prompt (replace stub)

**File:** `src/lib/ai/prompts.ts` — replace `WORLD_STATE_SYSTEM_PROMPT` stub.

**What the prompt must produce:**

A World State document in tagged format (`[H2]` sections). No signal digit prefix. Sections:

1. **Current State (Post-Pilot)** — where each primary character stands after Episode 1. Emotional state, relationships, what they know, what they want. Grounded in the pilot as actually written.
2. **Series-End Destination** — where the story ends. Derived from the original source's full arc. Not episode-by-episode; the final state of each character and plot thread.
3. **Character Map** — brief voice note per primary character (1-2 lines each). Source: Characters tab.
4. **Batch Continuity** (only on 2nd+ batch) — if prior locked beats were passed, summarise what has already been committed so this batch doesn't contradict it.

**Instruction framing the prompt must include:**
- You receive: Original Research (the source story + OG episode summaries), Characters, Pilot (Predefined Episode 1), and optionally prior locked beat batches.
- Your job is to map where things stand NOW (post-pilot) and where they must end up (series end). Do not plan intermediate episodes — that is Step 2's job.
- Use only what is explicitly in the source material. Do not invent events not in the research.
- Format: `[H1] World State`, then `[H2]` sections as above.

**Accept criteria:** chat draft shows a credible post-pilot state + a specific series-end destination grounded in the OG story arc. Transfer to workbook; move to World State tab; Suggest Beats button unlocks.

---

## Step 6 — Suggest Beats prompt (replace stub)

**File:** `src/lib/ai/prompts.ts` — replace `BEAT_GEN_SYSTEM_PROMPT` stub.

**What the prompt must produce:**

25–35 candidate scene-level beats in a single `[H2] Batch (draft)` block. Each beat is a `[H3]` heading that names the beat (e.g. `[H3] Beat 7: The Confrontation at the Office`) followed by one `[P]` describing the scene in 1–3 sentences: who is there, what happens, what changes.

Beats are:
- Unordered, uncommitted — the writer curates them
- Scene-level (one scene each), not episode-level
- Causally generative — each beat implies consequences; avoid isolated events
- Varied in dramatic role (setups, escalations, confrontations, fallouts) — don't cluster all confrontations together

**Instruction framing:**
- You receive: World State only. Nothing else.
- Generate a wide spread of possible scene beats. Volume target: 25–35. The writer will curate, not you.
- Do not sequence them or assign episode numbers — that is the writer's job and Step 3's job.
- Format: `[H1] Beats`, then `[H2] Batch (draft)`, then `[H3]` beats.

**Accept criteria:** 25–35 beats; refining via chat ("keep 1, 3, 5, add a beat where X happens") works; writer moves curated beats to Beats tab; Connect button unlocks.

---

## Step 7 — Connect the Story prompt (replace stub)

**File:** `src/lib/ai/prompts.ts` — replace `CAUSALITY_SYSTEM_PROMPT` stub.

**What the prompt must produce:**

A Story Logic document that gives each beat from the Beats tab:
- **Who/What:** the key character(s) and the core action
- **When:** relative position in the story arc (early / mid / late — no episode numbers yet)
- **Why:** the causal trigger — what from the World State or a prior beat forces this beat to happen
- **What it causes:** the direct consequence that makes the next beat possible
- **Dramatic role:** one of — Plant / Escalation / Confrontation / Fallout

The dramatic role tags are what Step 8 (Plot Synthesizer) uses to map beats to Foreshadow / Anticipation / Action / Reaction in the Plot Arc framework.

Format: `[H1] Story Logic`, then one `[H2]` per beat (using the same beat name from the Beats tab), containing `[P]` lines for each field.

**Instruction framing:**
- You receive: World State + Beats.
- For each beat in the Beats tab, produce the causal analysis above.
- You are building a causal chain, not a sequence. If beat X can't happen unless beat Y happened first, say so explicitly under "Why."
- Do not assign episode numbers. That is Step 4's job.

**Accept criteria:** every beat from the Beats tab is accounted for; each has a dramatic role tag; Write Plots button unlocks.

---

## Step 8 — Write Plots prompt (replace stub)

**File:** `src/lib/ai/prompts.ts` — replace `PLOT_SYNTH_SYSTEM_PROMPT` stub.

**What the prompt must produce:**

7–8 episode plots. Each plot MUST match the exact output format of `NEXT_EPISODE_PLOT_SYSTEM_PROMPT` (the export starts at `prompts.ts:2226`; the OUTPUT FORMAT block is `:2300-2326`) — copy the labeled-paragraph structure verbatim into this prompt so the model has it as a hard contract.

**The format (11 `[P]` blocks inside one `[H3]`):**

```
[H3] Episode N: <Title — 3-7 words, never generic>

[P] Phase context: Phase <N> (<Phase Title>). Spine state at start: <one phrase>. Spine state at end: <one phrase>.
[P] Hook (0-3s, <Hook Type>): <single concrete opening shot or line>
[P] Setup-in-motion (4-15s): <the mini-climax beat>
[P] Body (16-55s): <3-4 plot beats>
[P] Cliffhanger (55-60s, <Cliffhanger Type>): <freeze-frame moment, NOT a question — a moment>
[P] Spine motion: <one sentence — how Plot A advanced>
[P] Plot Arc stage: <Plot [A/B] Arc N — Foreshadow / Anticipation / Action / Reaction. Trigger / seed as required>
[P] Characters present: <primaries + what they want THIS episode + enters as: [state, cite ep] + exits as: [state]>
[P] Information state delta: <what audience learns. Dramatic-irony gap if any.>
[P] Location: <where this episode is set>
[P] Setup-payoff trace: <plant or payoff or "no long-arc plant or payoff this episode">
```

That is 11 `[P]` blocks. The source prompt's closing line (`:2326`) says "Ten" — that is a typo in the original. This prompt should say "Eleven" and list all 11.

**Instruction framing:**
- You receive: World State + Story Logic + Characters.
- Group beats from Story Logic into 7–8 episodes. Each episode covers 1–3 beats. Assign beats to episodes such that each episode has a clear hook, body, and cliffhanger.
- Use the dramatic role tags from Story Logic to assign Plot Arc stages: Plant → Foreshadow, Escalation → Anticipation, Confrontation → Action, Fallout → Reaction.
- Episode numbering: if prior batches exist, start at the correct next episode number (the World State section includes batch continuity context).
- Body of each [H3] must be > 60 non-whitespace chars or it will be rejected downstream.
- No signal digit (no leading `0` or `1`). No preamble. No closing tags.

**Accept criteria:** 7–8 plots, each with all 11 labeled `[P]` blocks, numbered `[H3] Episode N`, body > 60 chars, no signal digit, no closing tags. Move to Plots tab. Downstream proof is Step 9.

---

## Step 9 — Downstream proof (manual test)

**Goal:** confirm a synthesized plot expands correctly through the unchanged Plot → Predefined Episode flow.

**How to test:**
1. Ensure a World State → Beats → Story Logic → Plots run has completed and Plots tab has at least one `[H3] Episode N` entry.
2. Switch to the Predefined Episodes tab.
3. Type a request to generate the next reference episode (triggers `next_reference_episode` job as normal).
4. Confirm the job: finds the new plot by episode number, reads its body fields (Phase context, Hook, Cliffhanger, etc.), and expands it into a full reference episode format.

If the job can't find the plot (e.g., `splitTabByH3` + `extractEpisodeNumber` mismatch), investigate the Tiptap JSON in the Plots tab — the `[H3]` tags must be actual heading nodes, not paragraph text. If paste from chat created paragraphs instead of headings, the "Apply to workbook" button described in the spec risks note is needed. Diagnose before building it — only build if confirmed broken.

**Accept criteria:** a new reference episode is generated that references events from the synthesized plot.

---

## Step 10 — Batch handoff (manual test)

**Goal:** confirm a second batch of plots picks up continuity correctly.

**How to test:**
1. Move Batch 1's curated beats to the Beats tab (the locked source).
2. Click Build World again.
3. Confirm the World State draft includes a "Batch Continuity" or "Prior Locked Beats" section that accurately summarises what Batch 1 committed.
4. Run through Beats → Story Logic → Plots again. Confirm Batch 2 plots start at the correct episode number (Episode 8 if Batch 1 produced Eps 1–7) and don't contradict Batch 1 events.

**Accept criteria:** Batch 2 World State references Batch 1 beats; Batch 2 plots number sequentially from where Batch 1 ended.

---

## Deferred to v2 (do NOT build now)

| Item | v1 baseline | v2 intent |
|---|---|---|
| **Heading-validation gate** | `isTabNonEmpty` — any non-empty content in the destination tab unlocks the next step. | Validate the pasted content actually contains that step's required `[H2]` sections before unlocking (e.g. World State must have Current State / Series-End Destination / Character Map). |
| **One-click Apply-to-tab handoff** | Manual: writer copies chat draft → Workbook → destination tab. `onApplyToTab` prop exists but is unused by the pipeline. | Per-step "Send draft to [tab]" button; requires `parseTaggedLines` so paste lands as real heading nodes (see paste-node risk below). |

Copy-paste handoff is accepted for v1 by founder decision (2026-07-20). These are enhancements, not blockers.

---

## Debugging — logs to add and how to read them

All three failure modes below fail **silently** today, so instrument them. Client logs use `console.debug` (prefix `[pipeline:…]`, gated behind `typeof window !== "undefined"`) — read them in the browser DevTools console. Server logs use the existing `logTrace`/`logEvent` (`@/lib/saveTrace`) — read them in Cloud Run.

| Symptom | Log that catches it | Where |
|---|---|---|
| Step button runs the wrong prompt (chat instead of the pipeline step) | `[pipeline:send] { effectiveMode }` + `ai.edit.prompt_resolved { mode }` | console + server |
| Pipeline prompt not found → fell back to code stub | `ai.edit.prompt_resolved { source: "fallback" }` | server |
| Wrong context sent to a step (dilution leak) | `[pipeline:context] { stepId, sections }` | console |
| Step pick didn't produce context | `[pipeline:step] { stepId, contextChars }` | console |
| Backfill didn't add tabs to a doc | `tabs.heal.seed_fixed`, `backfill.pipeline_tabs.done` | server |

**The one to watch:** `[pipeline:context].sections` prints the `=== Label ===` header of every block a step sends. For **Suggest Beats** it must list ONLY `World State` (plus `Current Working Draft (Workbook)` if the workbook has content). If skeleton, plots, or predefined episodes appear, the SENDS/EXCLUDES contract leaked — that is the dilution gate from Step 4's accept criteria, made visible.

**The trace to run end-to-end:** click a step → `[pipeline:step]` fires with the stepId → `[pipeline:send].effectiveMode` equals that stepId → server logs `ai.edit.prompt_resolved { mode: <stepId>, source: "db" }`. Any link showing `chat` or `fallback` localises the break instantly.

---

## Files changed (total)

### Edited
| File | What changes |
|---|---|
| `src/lib/canonical-tabs.ts` | `CanonicalTabType` + 3 new `CANONICAL_TABS` entries |
| `src/lib/tab-heal.ts` | `classify()` + comment update |
| `src/components/editor/TabRail.tsx` | `TabType` + 3 badge entries |
| `src/app/api/documents/[id]/tabs/route.ts` | `VALID_TYPES` |
| `src/lib/ai/prompts.ts` | 4 new exported constants (stubs → real prompts in Steps 5–8) |
| `src/lib/ai/seed-prompts.ts` | 4 imports + 4 `DEFAULTS` entries |
| `src/app/api/ai/edit/route.ts` | `Mode` type + `FALLBACK_PROMPTS` + 4 imports + `logTrace` import + `ai.edit.prompt_resolved` log |
| `src/lib/ai/context-engine.ts` | `buildPipelineStepContext` function (+ `[pipeline:context]` debug log) |
| `src/components/ai/AIChatSidebar.tsx` | `activeStep` state, step registry, buttons, gating, dynamic mode, **`sendMessages` gains a `modeOverride` param** (closure-bug fix), `[pipeline:step]` + `[pipeline:send]` debug logs |

### New
| File | What it is |
|---|---|
| `src/app/api/admin/backfill-pipeline-tabs/route.ts` | One-time admin route — loops all docs calling `healFixedTabs` (reuse, not a bespoke insert loop) |

### Intentionally untouched
- `src/lib/ai/actions.ts` — no pipeline loading changes
- `src/lib/ai/jobs.ts` — pipeline runs on inline chat path, not durable jobs
- `src/components/ai/WorkbookActions.tsx` — no new action buttons here
- `src/app/doc/[id]/page.tsx` — no new auto-apply wiring
- `src/lib/db/schema.ts` — no schema change
- All skeleton prompts and skeleton job wiring — decommission is a separate later PR

---

## After all steps pass — PR

```bash
git add <all changed files>
npm run build           # must be clean
npm run lint            # errors only; warnings ok
git commit -m "feat: Multi-Step Episode Pipeline (Build World / Suggest Beats / Connect / Write Plots)"
gh pr create --title "feat: Multi-Step Episode Pipeline" --base main
```

Cloud Run auto-deploys from `main` via Cloud Build (asia-south1). Confirm the new revision is serving after merge. Run the backfill route once on prod: `POST /api/admin/backfill-pipeline-tabs` (admin auth required).

---

## Risks to watch

| Risk | Mitigation |
|---|---|
| Chat paste from Plots tab creates paragraph nodes instead of heading nodes | Check Tiptap JSON after paste; if `[H3]` text becomes a `<p>` not a `<heading>`, add "Apply to Workbook" button that runs `parseTaggedLines`. Don't pre-build; confirm failure mode first. |
| Build World references incorrect Episode 1 | `splitTabByH3` + `extractEpisodeNumber(heading) === 1` — if pilot is not labelled `[H3] Episode 1`, it won't be found. Confirm in Step 1b. |
| Thinking hardcoded ON in route (`edit/route.ts:76-79`, not `:64`) | All pipeline steps inherit this. The `thinking` body param is destructured but never used. Leave as-is for now — tracked as a separate fix. |
| Pipeline steps run on `gemini-3.1-pro-preview` | The sidebar force-sets `onSetModel("gemini-3.1-pro-preview")` on mount (`AIChatSidebar.tsx:400-404`) and always passes that `modelId`; the route's `claude-sonnet` default never applies. This is the model MEMORY records as 429-ing in prod. Steps 5–8 draft-quality testing must account for that model, not Sonnet. Out of scope to change here — flag if 429s block testing. |
| `sendMessages` fires with empty context (no research, no characters) | `buildPipelineStepContext` returns a string even when tabs are empty; the stub prompt echoes whatever arrives. Writer sees an empty context echo and knows the doc isn't ready. No crash. |
