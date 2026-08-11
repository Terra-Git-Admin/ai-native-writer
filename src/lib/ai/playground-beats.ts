import { nanoid } from "nanoid";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlaygroundBeat {
  id: string;
  text: string;
  locked: boolean;
  batch?: string;
}

// ─── Tiptap node helpers ──────────────────────────────────────────────────────

interface TiptapNode {
  type?: string;
  attrs?: { level?: number };
  content?: TiptapNode[];
  text?: string;
}

function textOf(node: TiptapNode): string {
  if (typeof node.text === "string") return node.text;
  if (!node.content) return "";
  return node.content.map(textOf).join("");
}

// Split a paragraph node at hardBreak children into individual text lines.
// Handles the case where beats are typed/pasted as Shift+Enter lines inside
// one paragraph rather than as separate paragraph nodes.
function splitAtHardBreaks(node: TiptapNode): string[] {
  const lines: string[] = [];
  let current = "";
  for (const child of node.content ?? []) {
    if (child.type === "hardBreak") {
      lines.push(current);
      current = "";
    } else {
      current += textOf(child);
    }
  }
  lines.push(current);
  return lines;
}

export const BEAT_LINE_RE = /^Beat\s+\d+:/i;

// ─── Parse ────────────────────────────────────────────────────────────────────

export function parseBeatsFromTiptap(content: string | null): PlaygroundBeat[] {
  if (!content) return [];
  let doc: TiptapNode;
  try {
    doc = JSON.parse(content);
  } catch {
    return [];
  }

  const beats: PlaygroundBeat[] = [];
  let currentBatch: string | undefined;
  // pendingBeat: a "Beat N: Title" paragraph we've seen but not yet finalized.
  // The next non-Beat paragraph is its description and gets appended before we push.
  let pendingBeat: PlaygroundBeat | null = null;

  function flushPending() {
    if (pendingBeat) { beats.push(pendingBeat); pendingBeat = null; }
  }

  for (const node of doc.content ?? []) {
    if (node.type === "heading") {
      if (node.attrs?.level === 1) continue; // Skip [H1] section title
      if (node.attrs?.level === 2) {
        flushPending();
        currentBatch = textOf(node).trim() || undefined;
      }
      if (node.attrs?.level === 3) {
        // Old H3 format: title is the H3 text; following P is the description.
        flushPending();
        const text = textOf(node).trim();
        if (text) pendingBeat = { id: nanoid(8), text, locked: false, batch: currentBatch };
      }
    } else if (node.type === "paragraph") {
      const lines = splitAtHardBreaks(node);
      const hasHardBreaks = lines.length > 1;

      if (hasHardBreaks) {
        // Beats stored as Shift+Enter lines in one paragraph. Apply the same pending-beat
        // pattern as separate-paragraph beats so descriptions are captured.
        flushPending();
        for (const line of lines) {
          const text = line.trim();
          if (!text) continue; // empty separator line — keep pending beat alive
          if (BEAT_LINE_RE.test(text)) {
            flushPending();
            pendingBeat = { id: nanoid(8), text, locked: false, batch: currentBatch };
          } else if (pendingBeat) {
            // Description line — append to the pending beat.
            const pb: PlaygroundBeat = pendingBeat;
            pendingBeat = { ...pb, text: `${pb.text}\n${text}` };
          }
          // else: preamble line before any beat → skip
        }
      } else {
        const text = (lines[0] ?? "").trim();
        if (!text) continue;

        if (BEAT_LINE_RE.test(text)) {
          // Start a new pending beat, flushing any previous one (beat without description).
          flushPending();
          pendingBeat = { id: nanoid(8), text, locked: false, batch: currentBatch };
        } else if (pendingBeat) {
          // Description paragraph — append to the pending beat and finalize.
          const pb: PlaygroundBeat = pendingBeat;
          pendingBeat = { ...pb, text: `${pb.text}\n${text}` };
          flushPending();
        }
        // else: non-Beat P with no pending beat (preamble, stray text) → skip
      }
    } else if (node.type === "bulletList" || node.type === "orderedList") {
      flushPending();
      for (const item of node.content ?? []) {
        if (item.type === "listItem") {
          const text = textOf(item).trim();
          if (text) beats.push({ id: nanoid(8), text, locked: false, batch: currentBatch });
        }
      }
    } else {
      flushPending();
    }
  }

  flushPending();
  return beats;
}

// ─── Render ───────────────────────────────────────────────────────────────────

function beatToTaggedLines(beat: PlaygroundBeat): string[] {
  // One beat = exactly one [UL] bullet. Collapse any embedded newlines (legacy
  // "Title\nDescription" beats, or user edits with Enter) into a single line —
  // emitting multiple lines here would re-parse into multiple beats and silently
  // duplicate them. Strip any legacy "Beat N:" prefix so old docs lose numbering too.
  const collapsed = beat.text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/^Beat\s+\d+:\s*/i, "");
  return collapsed ? [`[UL] ${collapsed}`] : [];
}

export function renderLockedBeatsTagged(beats: PlaygroundBeat[]): string {
  const locked = beats.filter((b) => b.locked);
  const lines: string[] = [];
  let lastBatch: string | undefined = undefined;

  for (const beat of locked) {
    if (beat.batch !== lastBatch) {
      if (beat.batch) lines.push(`[H2] ${beat.batch}`);
      lastBatch = beat.batch;
    }
    lines.push(...beatToTaggedLines(beat));
  }

  return lines.join("\n");
}

export function renderAllBeatsTagged(beats: PlaygroundBeat[]): string {
  const lines: string[] = [];
  let lastBatch: string | undefined = undefined;

  for (const beat of beats) {
    if (beat.batch !== lastBatch) {
      if (beat.batch) lines.push(`[H2] ${beat.batch}`);
      lastBatch = beat.batch;
    }
    lines.push(...beatToTaggedLines(beat));
  }

  return lines.join("\n");
}

// ─── Lock preservation on refresh ─────────────────────────────────────────────

export function preserveLockState(
  incoming: PlaygroundBeat[],
  existing: PlaygroundBeat[]
): PlaygroundBeat[] {
  const lockMap = new Map(
    existing.map((b) => [b.text.trim().toLowerCase(), b.locked])
  );
  return incoming.map((b) => ({
    ...b,
    locked: lockMap.get(b.text.trim().toLowerCase()) ?? false,
  }));
}
