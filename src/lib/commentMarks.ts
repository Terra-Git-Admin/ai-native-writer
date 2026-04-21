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

export function isCommentMarkOnlyDiff(a: unknown, b: unknown): boolean {
  return (
    JSON.stringify(stripCommentMarks(a)) ===
    JSON.stringify(stripCommentMarks(b))
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
