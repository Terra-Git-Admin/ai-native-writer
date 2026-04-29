// Pure tagged-text → Tiptap JSON conversion.
//
// The AI emits content as one tag per line — [H1] [H2] [H3] [P] [OL] [UL] —
// with no closing tags and no markdown. This module turns that string into a
// Tiptap doc node so callers can either feed it to a live editor (via
// editor.commands.setContent) or PUT it as JSON to a non-mounted tab via the
// tab-content API.
//
// Lifted out of Editor.tsx so the cross-tab apply path can call it without
// mounting an editor for the target tab. Pure: no React, no DOM, no editor
// state — safe to import from anywhere.

// Parse the AI's tagged output into Tiptap JSON nodes.
export function parseTaggedLines(lines: string[]): object[] {
  const nodes: object[] = [];
  let listType: "orderedList" | "bulletList" | null = null;
  let listItems: string[] = [];

  const flushList = () => {
    if (listType && listItems.length > 0) {
      nodes.push({
        type: listType,
        content: listItems.map((t) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
        })),
      });
      listItems = [];
      listType = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const ol = line.match(/^\[OL\]\s*(.+)/i);
    const ul = line.match(/^\[UL\]\s*(.+)/i);
    const h = line.match(/^\[H([1-6])\]\s*(.+)/i);
    const p = line.match(/^\[P\]\s*(.+)/i);

    if (ol) {
      if (listType !== "orderedList") flushList();
      listType = "orderedList";
      listItems.push(ol[1]);
    } else if (ul) {
      if (listType !== "bulletList") flushList();
      listType = "bulletList";
      listItems.push(ul[1]);
    } else if (h) {
      flushList();
      // Clamp to H1-H3 so AI-returned [H4]+ don't render headings the writer
      // can't easily format back with the toolbar (which only goes to H3).
      const raw = parseInt(h[1]);
      const level = raw > 3 ? 3 : raw < 1 ? 1 : raw;
      nodes.push({
        type: "heading",
        attrs: { level },
        content: [{ type: "text", text: h[2] }],
      });
    } else if (p) {
      flushList();
      nodes.push({
        type: "paragraph",
        content: [{ type: "text", text: p[1] }],
      });
    } else {
      // Untagged fallback — strip any leading [TAG] prefix the AI emitted that
      // our known tags didn't match (e.g. [BQ], [CODE], [NOTE]). Without this
      // the bracketed marker leaks into the paragraph as literal text, which
      // writers have hit in practice. Also strip markdown bullet/number/bold
      // markers while we're here.
      const t = line
        .replace(/^\[[A-Z0-9_-]+\]\s*/i, "")
        .replace(/^[-*•]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/\*\*/g, "");
      if (t) {
        flushList();
        nodes.push({ type: "paragraph", content: [{ type: "text", text: t }] });
      }
    }
  }
  flushList();
  return nodes;
}

export interface TiptapDoc {
  type: "doc";
  content: object[];
}

// Convert tagged text to a Tiptap doc. If the input has no structural tags,
// fall back to splitting on blank lines and wrapping each chunk as a
// paragraph — same shape Editor.setFullContent used to produce inline.
//
// Returns a doc node ready for `editor.commands.setContent(...)` OR for
// `JSON.stringify(...)` and PUT to /api/documents/:id/tabs/:tabId/content.
export function taggedTextToTiptapDoc(content: string): TiptapDoc {
  const lines = content.split("\n").filter((l) => l.trim());
  const hasStructuralTags = lines.some((l) =>
    /^\[(?:H\d|OL|UL|P|HR)\]/.test(l)
  );
  if (hasStructuralTags) {
    return { type: "doc", content: parseTaggedLines(lines) };
  }
  // Plain text — wrap each blank-line-separated chunk as a paragraph.
  const paragraphs = content
    .split("\n\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => ({
      type: "paragraph",
      content: [{ type: "text", text: p }],
    }));
  return {
    type: "doc",
    content: paragraphs.length > 0 ? paragraphs : [{ type: "paragraph" }],
  };
}
