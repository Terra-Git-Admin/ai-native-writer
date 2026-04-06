import { Mark, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    commentMark: {
      setCommentMark: (commentId: string) => ReturnType;
      unsetCommentMark: (commentId: string) => ReturnType;
    };
  }
}

export const CommentMark = Mark.create({
  name: "commentMark",
  priority: 1000,
  keepOnSplit: true,

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-comment-id"),
        renderHTML: (attrs) => {
          if (!attrs.commentId) return {};
          return { "data-comment-id": attrs.commentId };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-comment-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "comment-highlight",
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCommentMark:
        (commentId: string) =>
        ({ commands }) => {
          return commands.setMark(this.name, { commentId });
        },
      unsetCommentMark:
        (commentId: string) =>
        ({ tr, state, dispatch }) => {
          const { doc } = state;
          // Find and remove all marks with this commentId
          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (
                mark.type.name === this.name &&
                mark.attrs.commentId === commentId
              ) {
                if (dispatch) {
                  tr.removeMark(pos, pos + node.nodeSize, mark);
                }
              }
            });
          });
          return true;
        },
    };
  },
});
