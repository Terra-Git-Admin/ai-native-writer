import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

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

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
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
