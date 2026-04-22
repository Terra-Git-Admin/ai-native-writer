// Tiptap JSON doc helpers for commentMark operations. Shared by server (save
// path, seatbelt, orphan detection) and client (poll comment-mark-only gate).

type JsonNode = {
  type?: string;
  content?: JsonNode[];
  marks?: Array<{ type?: string; attrs?: { commentId?: string } }>;
  [k: string]: unknown;
};

export function extractCommentMarkIds(doc: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    const node = n as JsonNode;
    if (Array.isArray(node.marks)) {
      for (const m of node.marks) {
        if (
          m &&
          m.type === "commentMark" &&
          m.attrs &&
          typeof m.attrs.commentId === "string"
        ) {
          out.add(m.attrs.commentId);
        }
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(doc);
  return out;
}

export function stripCommentMarks(doc: unknown): unknown {
  if (Array.isArray(doc)) return doc.map(stripCommentMarks);
  if (doc && typeof doc === "object") {
    const o = doc as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === "marks" && Array.isArray(v)) {
        const filtered = (v as Array<{ type?: string }>)
          .filter((m) => m?.type !== "commentMark")
          .map(stripCommentMarks);
        // omit empty to match nodes that have no `marks` key at all
        if (filtered.length > 0) out[k] = filtered;
      } else {
        out[k] = stripCommentMarks(v);
      }
    }
    return out;
  }
  return doc;
}

// Tiptap normalises node attrs on load — extensions like TextAlign add
// `textAlign: null` to headings/paragraphs even when the stored JSON didn't
// carry it. Raw JSON equality then fails against the in-editor state even
// though the docs are semantically identical. We strip null/undefined attrs
// before comparing so normalisation-only differences don't look like content
// changes.
export function stripNullAttrs(doc: unknown): unknown {
  if (Array.isArray(doc)) return doc.map(stripNullAttrs);
  if (doc && typeof doc === "object") {
    const o = doc as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === "attrs" && v && typeof v === "object" && !Array.isArray(v)) {
        const cleaned: Record<string, unknown> = {};
        for (const [ak, av] of Object.entries(v as Record<string, unknown>)) {
          if (av !== null && av !== undefined) cleaned[ak] = av;
        }
        if (Object.keys(cleaned).length > 0) out[k] = cleaned;
      } else {
        out[k] = stripNullAttrs(v);
      }
    }
    return out;
  }
  return doc;
}

// True when the two docs are structurally equal ignoring both comment marks
// and null-valued attrs (Tiptap normalisation). Used by the save-revert
// seatbelt AND the client poll to decide whether there's a "real" diff.
export function isCommentMarkOnlyDiff(a: unknown, b: unknown): boolean {
  return (
    JSON.stringify(stripNullAttrs(stripCommentMarks(a))) ===
    JSON.stringify(stripNullAttrs(stripCommentMarks(b)))
  );
}

// Tolerant equality check ignoring ONLY the attrs normalisation (comment
// marks still count). Used by the poll to decide if there's any diff worth
// reacting to before even asking whether it's comment-mark-only.
export function isNormalisedEqual(a: unknown, b: unknown): boolean {
  return (
    JSON.stringify(stripNullAttrs(a)) === JSON.stringify(stripNullAttrs(b))
  );
}

export type DocDiff = {
  marksBefore: string[];
  marksIncoming: string[];
  marksAdded: string[];
  marksRemoved: string[];
  nonMarkContentDiffers: boolean;
};

export function compareDocs(
  before: unknown,
  incoming: unknown
): DocDiff {
  const b = extractCommentMarkIds(before);
  const i = extractCommentMarkIds(incoming);
  const added = [...i].filter((x) => !b.has(x));
  const removed = [...b].filter((x) => !i.has(x));
  return {
    marksBefore: [...b].sort(),
    marksIncoming: [...i].sort(),
    marksAdded: added.sort(),
    marksRemoved: removed.sort(),
    nonMarkContentDiffers: !isCommentMarkOnlyDiff(before, incoming),
  };
}
