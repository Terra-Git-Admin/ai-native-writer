import { Editor, Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

function moveTopLevelBlocks(editor: Editor, direction: "up" | "down") {
  const { state, view } = editor;
  const { doc, selection } = state;
  const from = selection.from;
  const to = selection.to;
  const blocks: Array<{ index: number; start: number; end: number; nodeSize: number }> = [];

  doc.forEach((node, offset, index) => {
    const start = offset;
    const end = offset + node.nodeSize;
    if (end >= from && start <= to) {
      blocks.push({ index, start, end, nodeSize: node.nodeSize });
    }
  });

  if (blocks.length === 0) return false;
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  if (direction === "up" && first.index === 0) return false;
  if (direction === "down" && last.index >= doc.childCount - 1) return false;

  const rangeFrom = first.start;
  const rangeTo = last.end;
  const slice = doc.slice(rangeFrom, rangeTo);

  if (direction === "up") {
    const previous = doc.child(first.index - 1);
    const previousStart = rangeFrom - previous.nodeSize;
    const tr = state.tr.delete(rangeFrom, rangeTo).insert(previousStart, slice.content);
    const delta = previous.nodeSize;
    tr.setSelection(TextSelection.create(tr.doc, Math.max(1, selection.from - delta), Math.max(1, selection.to - delta)));
    tr.scrollIntoView();
    view.dispatch(tr);
    return true;
  }

  const next = doc.child(last.index + 1);
  const insertAt = rangeTo + next.nodeSize;
  const tr = state.tr.delete(rangeFrom, rangeTo).insert(insertAt - (rangeTo - rangeFrom), slice.content);
  const delta = next.nodeSize;
  tr.setSelection(TextSelection.create(tr.doc, selection.from + delta, selection.to + delta));
  tr.scrollIntoView();
  view.dispatch(tr);
  return true;
}

// Enter in a paragraph on the microdrama_plots tab:
// Split at cursor → keep first half as paragraph → insert empty H3 →
// move second half to new paragraph → cursor lands in H3 so writer
// can immediately type the episode title.
//
// Backspace at position 0 of an H3 is handled by ProseMirror's default
// joinBackward: it merges the H3 content into the previous block, which
// removes the episode boundary — no custom handler needed.

export const MicrodramaKeymap = Extension.create({
  name: "microdramaKeymap",

  addOptions() {
    return {
      enableMicrodramaEnter: false,
    };
  },

  addKeyboardShortcuts() {
    return {
      "Alt-ArrowUp": ({ editor }) => moveTopLevelBlocks(editor, "up"),
      "Alt-ArrowDown": ({ editor }) => moveTopLevelBlocks(editor, "down"),
      Enter: ({ editor }) => {
        if (!this.options.enableMicrodramaEnter) return false;
        const { state } = editor;
        const { selection } = state;
        const { $from, empty } = selection;

        if (!empty) return false;
        if ($from.parent.type.name !== "paragraph") return false;

        const { tr, schema } = state;
        const paragraphType = schema.nodes.paragraph;
        const headingType = schema.nodes.heading;

        const nodeStart = $from.before($from.depth);
        const nodeEnd = $from.after($from.depth);

        const beforeContent = $from.parent.content.cut(0, $from.parentOffset);
        const afterContent = $from.parent.content.cut($from.parentOffset);

        const firstPara = paragraphType.create($from.parent.attrs, beforeContent);
        const h3 = headingType.create({ level: 3 });
        const toInsert =
          afterContent.size > 0
            ? [firstPara, h3, paragraphType.create(null, afterContent)]
            : [firstPara, h3];

        tr.replaceWith(nodeStart, nodeEnd, toInsert);

        // Place cursor at the start of H3 content so the writer types the title.
        const h3Pos = nodeStart + firstPara.nodeSize + 1;
        tr.setSelection(TextSelection.create(tr.doc, h3Pos));
        tr.scrollIntoView();

        editor.view.dispatch(tr);
        return true;
      },
    };
  },
});
