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

const BEAT_LINE_RE = /^Beat\s+\d+:/i;

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
  // Old format: [H3] Beat N: Title followed by [P] description.
  // We use the H3 text as the beat (concise title), then skip the following P.
  let skipNextParagraph = false;

  for (const node of doc.content ?? []) {
    if (node.type === "heading") {
      if (node.attrs?.level === 1) continue; // Skip [H1] Beats title
      if (node.attrs?.level === 2) {
        currentBatch = textOf(node).trim() || undefined;
        skipNextParagraph = false;
      }
      if (node.attrs?.level === 3) {
        // Old H3 format: use title text as the beat, skip the following description paragraph
        const text = textOf(node).trim();
        if (text) {
          beats.push({ id: nanoid(8), text, locked: false, batch: currentBatch });
          skipNextParagraph = true;
        }
      }
    } else if (node.type === "paragraph") {
      const lines = splitAtHardBreaks(node);
      const hasHardBreaks = lines.length > 1;

      if (hasHardBreaks) {
        // Beats pasted/typed as Shift+Enter lines inside one paragraph.
        // Extract only lines that look like "Beat N: ..." — skip preamble/descriptions.
        skipNextParagraph = false;
        for (const line of lines) {
          const text = line.trim();
          if (text && BEAT_LINE_RE.test(text)) {
            beats.push({ id: nanoid(8), text, locked: false, batch: currentBatch });
          }
        }
      } else {
        const text = (lines[0] ?? "").trim();
        if (!text) continue; // Skip empty without clearing skipNextParagraph
        if (skipNextParagraph) {
          skipNextParagraph = false;
          continue; // Skip description P that follows an H3 title
        }
        beats.push({ id: nanoid(8), text, locked: false, batch: currentBatch });
      }
    } else if (node.type === "bulletList" || node.type === "orderedList") {
      skipNextParagraph = false;
      for (const item of node.content ?? []) {
        if (item.type === "listItem") {
          const text = textOf(item).trim();
          if (text) beats.push({ id: nanoid(8), text, locked: false, batch: currentBatch });
        }
      }
    } else {
      skipNextParagraph = false;
    }
  }

  return beats;
}

// ─── Render ───────────────────────────────────────────────────────────────────

export function renderLockedBeatsTagged(beats: PlaygroundBeat[]): string {
  const locked = beats.filter((b) => b.locked);
  const lines: string[] = [];
  let lastBatch: string | undefined = undefined;

  for (const beat of locked) {
    if (beat.batch !== lastBatch) {
      if (beat.batch) lines.push(`[H2] ${beat.batch}`);
      lastBatch = beat.batch;
    }
    lines.push(`[P] ${beat.text}`);
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
    lines.push(`[P] ${beat.text}`);
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
