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

  for (const node of doc.content ?? []) {
    if (node.type === "heading") {
      if (node.attrs?.level === 1) continue; // Skip [H1] Beats title
      if (node.attrs?.level === 2) {
        currentBatch = textOf(node).trim() || undefined;
      }
    } else if (node.type === "paragraph") {
      const text = textOf(node).trim();
      if (text) beats.push({ id: nanoid(8), text, locked: false, batch: currentBatch });
    } else if (node.type === "bulletList" || node.type === "orderedList") {
      for (const item of node.content ?? []) {
        if (item.type === "listItem") {
          const text = textOf(item).trim();
          if (text) beats.push({ id: nanoid(8), text, locked: false, batch: currentBatch });
        }
      }
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
