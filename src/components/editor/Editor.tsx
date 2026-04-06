"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import CharacterCount from "@tiptap/extension-character-count";
import FontFamily from "@tiptap/extension-font-family";
import { TextStyle, FontSize, Color } from "@tiptap/extension-text-style";
import { CommentMark } from "@/extensions/comment-mark";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";
import EditorToolbar from "./EditorToolbar";
import type { EditorState } from "@tiptap/pm/state";

export type TaggedBlock = {
  line: string; // full tagged string e.g. "[OL] Flutter app in V2..."
  from: number; // document position start
  to: number;   // document position end
};

export interface HeadingItem {
  level: 1 | 2 | 3;
  text: string;
  pos: number; // ProseMirror doc position of the heading node
}

// Walk the selection and extract each block as a tagged line, recording positions.
function extractTaggedBlocks(state: EditorState, from: number, to: number): TaggedBlock[] {
  const blocks: TaggedBlock[] = [];
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.type.name === "listItem") {
      const tag = parent?.type.name === "orderedList" ? "[OL]" : "[UL]";
      const text = node.textContent.trim();
      if (text) {
        blocks.push({
          line: `${tag} ${text}`,
          from: pos,
          to: pos + node.nodeSize,
        });
      }
      return false;
    }
    if (node.type.name === "heading") {
      const text = node.textContent.trim();
      if (text) {
        blocks.push({
          line: `[H${node.attrs.level}] ${text}`,
          from: pos,
          to: pos + node.nodeSize,
        });
      }
      return false;
    }
    if (node.type.name === "paragraph" && parent?.type.name !== "listItem") {
      const text = node.textContent.trim();
      if (text) {
        blocks.push({
          line: `[P] ${text}`,
          from: pos,
          to: pos + node.nodeSize,
        });
      }
      return false;
    }
    return true;
  });
  return blocks;
}

// Parse the AI's tagged output into Tiptap JSON nodes.
function parseTaggedLines(lines: string[]): object[] {
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
    const ol = line.match(/^\[OL\]\s*(.+)/);
    const ul = line.match(/^\[UL\]\s*(.+)/);
    const h = line.match(/^\[H(\d)\]\s*(.+)/);
    const p = line.match(/^\[P\]\s*(.+)/);

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
      nodes.push({
        type: "heading",
        attrs: { level: parseInt(h[1]) },
        content: [{ type: "text", text: h[2] }],
      });
    } else if (p) {
      flushList();
      nodes.push({
        type: "paragraph",
        content: [{ type: "text", text: p[1] }],
      });
    } else {
      // Untagged fallback — strip markdown markers
      const t = line.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "").replace(/\*\*/g, "");
      if (t) {
        flushList();
        nodes.push({ type: "paragraph", content: [{ type: "text", text: t }] });
      }
    }
  }
  flushList();
  return nodes;
}

interface EditorProps {
  documentId: string;
  initialContent: string | null;
  isOwner: boolean;
  activeCommentId: string | null;
  onAIEditRequest?: (
    displayText: string,
    taggedText: string,
    taggedBlocks: TaggedBlock[],
    from: number,
    to: number,
    surroundingContext: string
  ) => void;
  onAddComment?: (commentMarkId: string, quotedText: string, from: number, to: number) => void;
  onHeadingsChange?: (headings: HeadingItem[]) => void;
}

export interface EditorHandle {
  scrollToComment: (commentId: string) => void;
  removeCommentMark: (commentId: string) => void;
  applyCommentMark: (commentMarkId: string, from: number, to: number) => void;
  replaceRange: (
    taggedAIResponse: string,
    originalBlocks: TaggedBlock[],
    selectionFrom: number,
    selectionTo: number
  ) => void;
  getFullText: () => string;
  isEmpty: () => boolean;
  setFullContent: (content: string) => void;
  findAndReplace: (original: string, replacement: string) => void;
  highlightSelection: (from: number, to: number, color: string) => void;
  removeHighlight: (from: number, to: number) => void;
  scrollToHeading: (pos: number) => void;
}

const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  {
    documentId,
    initialContent,
    isOwner,
    activeCommentId,
    onAIEditRequest,
    onAddComment,
    onHeadingsChange,
  },
  ref
) {
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">(
    "saved"
  );
  const saveTimeout = useRef<NodeJS.Timeout | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "Start writing your script...",
      }),
      Underline,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Link.configure({
        openOnClick: false,
      }),
      CharacterCount,
      CommentMark,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
    ],
    content: initialContent ? JSON.parse(initialContent) : undefined,
    editable: isOwner,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      if (!isOwner) return;
      setSaveStatus("unsaved");

      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => {
        saveDocument(editor.getJSON());
      }, 1000);
    },
  });

  useImperativeHandle(ref, () => ({
    removeCommentMark(commentId: string) {
      removeCommentMark(commentId);
    },
    applyCommentMark(commentMarkId: string, from: number, to: number) {
      if (!editor) return;
      const wasEditable = editor.isEditable;
      if (!wasEditable) editor.setEditable(true);
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .setCommentMark(commentMarkId)
        .run();
      if (!wasEditable) editor.setEditable(false);
      triggerSave();
    },
    replaceRange(
      taggedAIResponse: string,
      originalBlocks: TaggedBlock[],
      selectionFrom: number,
      selectionTo: number
    ) {
      if (!editor) return;
      const { state, view } = editor;

      const aiLines = taggedAIResponse.split("\n").filter((l) => l.trim());

      // Inline (single block): strip tags, use insertText to preserve marks
      if (originalBlocks.length <= 1) {
        const strippedText = taggedAIResponse
          .replace(/^\[(?:H\d|OL|UL|P)\]\s*/, "")
          .trim();
        view.dispatch(state.tr.insertText(strippedText, selectionFrom, selectionTo));
        editor.commands.focus();
        triggerSave();
        return;
      }

      // Multi-block: expand the selection to full block boundaries, then
      // replace the entire range with the AI response parsed into Tiptap nodes.
      // This avoids the list nesting issue — orderedList replaces orderedList,
      // not content inside it.
      const $from = state.doc.resolve(selectionFrom);
      const $to = state.doc.resolve(selectionTo);

      let expandedFrom = selectionFrom;
      let expandedTo = selectionTo;

      // Walk up from selection start to find the outermost block boundary
      for (let d = $from.depth; d > 0; d--) {
        const name = $from.node(d).type.name;
        if (
          ["orderedList", "bulletList", "heading"].includes(name) ||
          (name === "paragraph" &&
            $from.node(d - 1).type.name === "doc")
        ) {
          expandedFrom = $from.before(d);
          break;
        }
      }

      // Walk up from selection end
      for (let d = $to.depth; d > 0; d--) {
        const name = $to.node(d).type.name;
        if (
          ["orderedList", "bulletList", "heading"].includes(name) ||
          (name === "paragraph" &&
            $to.node(d - 1).type.name === "doc")
        ) {
          expandedTo = $to.after(d);
          break;
        }
      }

      const nodes = parseTaggedLines(aiLines);
      editor
        .chain()
        .focus()
        .insertContentAt({ from: expandedFrom, to: expandedTo }, nodes)
        .run();
      triggerSave();
    },
    scrollToComment(commentId: string) {
      if (!editor) return;
      const { doc } = editor.state;
      let found = false;
      doc.descendants((node, pos) => {
        if (found) return false;
        for (const mark of node.marks) {
          if (
            mark.type.name === "commentMark" &&
            mark.attrs.commentId === commentId
          ) {
            editor.commands.setTextSelection(pos);
            // Scroll the editor to the position
            const domNode = editor.view.domAtPos(pos);
            if (domNode.node instanceof HTMLElement) {
              domNode.node.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            } else if (domNode.node.parentElement) {
              domNode.node.parentElement.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            }
            found = true;
            return false;
          }
        }
      });
    },
    getFullText() {
      if (!editor) return "";
      return editor.state.doc.textContent;
    },
    isEmpty() {
      return !editor || editor.isEmpty;
    },
    setFullContent(content: string) {
      if (!editor) return;
      // Parse tagged lines into Tiptap JSON, then set as content
      const lines = content.split("\n").filter((l) => l.trim());
      const hasStructuralTags = lines.some((l) =>
        /^\[(?:H\d|OL|UL|P|HR)\]/.test(l)
      );
      if (hasStructuralTags) {
        const nodes = parseTaggedLines(lines);
        editor.commands.setContent({ type: "doc", content: nodes as [] });
      } else {
        // Plain text — wrap paragraphs
        const paragraphs = content
          .split("\n\n")
          .filter((p) => p.trim())
          .map((p) => `<p>${p.trim()}</p>`)
          .join("");
        editor.commands.setContent(paragraphs || "<p></p>");
      }
      triggerSave();
    },
    highlightSelection(from: number, to: number, color: string) {
      if (!editor) return;
      const wasEditable = editor.isEditable;
      if (!wasEditable) editor.setEditable(true);
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .setHighlight({ color })
        .run();
      if (!wasEditable) editor.setEditable(false);
    },
    removeHighlight(from: number, to: number) {
      if (!editor) return;
      const wasEditable = editor.isEditable;
      if (!wasEditable) editor.setEditable(true);
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .unsetHighlight()
        .run();
      if (!wasEditable) editor.setEditable(false);
    },
    scrollToHeading(pos: number) {
      if (!editor) return;
      editor.commands.setTextSelection(pos + 1);
      try {
        const domNode = editor.view.domAtPos(pos + 1).node as HTMLElement;
        domNode?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      } catch {
        // ignore if position is out of range
      }
    },
    findAndReplace(original: string, replacement: string) {
      if (!editor) return;
      const { doc } = editor.state;
      let targetPos = -1;
      let targetEnd = -1;

      // Clean the search text: strip quotes, extra whitespace, tags (opening and closing)
      const cleanSearch = original
        .replace(/^\s*["'"]\s*/, "")
        .replace(/\s*["'"]\s*$/, "")
        .replace(/\[\/(?:H\d|OL|UL|P|HR)\]/g, "")
        .replace(/^\[(?:H\d|OL|UL|P)\]\s*/, "")
        .replace(/\s+/g, " ")
        .trim();

      if (!cleanSearch) return;

      // Strategy 1: Exact match in text nodes
      doc.descendants((node, pos) => {
        if (targetPos >= 0) return false;
        if (node.isText && node.text) {
          const idx = node.text.indexOf(cleanSearch);
          if (idx >= 0) {
            targetPos = pos + idx;
            targetEnd = targetPos + cleanSearch.length;
            return false;
          }
        }
      });

      // Strategy 2: Match in block textContent
      if (targetPos < 0) {
        doc.descendants((node, pos) => {
          if (targetPos >= 0) return false;
          if (node.isBlock) {
            const blockText = node.textContent;
            const idx = blockText.indexOf(cleanSearch);
            if (idx >= 0) {
              targetPos = pos + 1 + idx;
              targetEnd = targetPos + cleanSearch.length;
              return false;
            }
          }
        });
      }

      // Strategy 3: Cross-block matching (original may span multiple document blocks)
      if (targetPos < 0) {
        const blocks: { pos: number; end: number; text: string }[] = [];
        doc.descendants((node, pos) => {
          if (node.isTextblock && node.textContent.trim()) {
            blocks.push({
              pos: pos + 1,
              end: pos + node.nodeSize - 1,
              text: node.textContent,
            });
          }
        });

        for (let i = 0; i < blocks.length && targetPos < 0; i++) {
          let concatDirect = "";
          let concatSpaced = "";
          for (let j = i; j < Math.min(i + 30, blocks.length); j++) {
            concatDirect += blocks[j].text;
            concatSpaced += (j > i ? " " : "") + blocks[j].text;
            if (
              concatDirect.includes(cleanSearch) ||
              concatSpaced.includes(cleanSearch)
            ) {
              targetPos = blocks[i].pos;
              targetEnd = blocks[j].end;
              break;
            }
          }
        }
      }

      // Strategy 4: Try progressively shorter prefixes (AI may have truncated)
      if (targetPos < 0) {
        const minLen = 15;
        for (
          let len = Math.min(cleanSearch.length, 60);
          len >= minLen;
          len -= 10
        ) {
          const prefix = cleanSearch.slice(0, len);
          doc.descendants((node, pos) => {
            if (targetPos >= 0) return false;
            if (node.isBlock) {
              const blockText = node.textContent;
              const idx = blockText.indexOf(prefix);
              if (idx >= 0) {
                // Found a prefix match — replace the whole block text
                // that starts with this prefix up to the end of the line
                targetPos = pos + 1 + idx;
                const endOfMatch = blockText.indexOf("\n", idx);
                targetEnd =
                  pos +
                  1 +
                  (endOfMatch >= 0 ? endOfMatch : blockText.length);
                return false;
              }
            }
          });
          if (targetPos >= 0) break;
        }
      }

      if (targetPos >= 0 && targetEnd > targetPos) {
        // Pre-process: strip closing tags and split inline tag sequences into lines
        const cleanedReplacement = replacement
          .replace(/\[\/(?:H\d|OL|UL|P|HR)\]/g, "")           // strip closing tags
          .replace(/(.)(\[(?:H\d|OL|UL|P|HR)\])/g, "$1\n$2"); // newline before inline tags

        // Check if replacement has structural tags
        const lines = cleanedReplacement.split("\n").filter((l) => l.trim());
        const hasStructuralTags = lines.some((l) =>
          /^\[(?:H\d|OL|UL|P|HR)\]/.test(l)
        );

        if (hasStructuralTags) {
          // Expand to block boundaries and replace with parsed nodes
          const state = editor.state;
          const $from = state.doc.resolve(targetPos);
          const $to = state.doc.resolve(targetEnd);
          let expandedFrom = targetPos;
          let expandedTo = targetEnd;
          for (let d = $from.depth; d > 0; d--) {
            const name = $from.node(d).type.name;
            if (
              ["orderedList", "bulletList", "heading"].includes(name) ||
              (name === "paragraph" && $from.node(d - 1).type.name === "doc")
            ) {
              expandedFrom = $from.before(d);
              break;
            }
          }
          for (let d = $to.depth; d > 0; d--) {
            const name = $to.node(d).type.name;
            if (
              ["orderedList", "bulletList", "heading"].includes(name) ||
              (name === "paragraph" && $to.node(d - 1).type.name === "doc")
            ) {
              expandedTo = $to.after(d);
              break;
            }
          }
          const nodes = parseTaggedLines(lines);
          editor
            .chain()
            .focus()
            .insertContentAt({ from: expandedFrom, to: expandedTo }, nodes)
            .run();
        } else {
          // Plain text replacement (strip any remaining closing tags)
          const plainText = replacement.replace(/\[\/(?:H\d|OL|UL|P|HR)\]/g, "").trim();
          editor.view.dispatch(
            editor.state.tr.insertText(plainText, targetPos, targetEnd)
          );
        }
        triggerSave();
      }
    },
  }));

  // Inject a dynamic <style> tag for active comment highlighting.
  // This survives Tiptap DOM re-renders (unlike manually adding classes to mark spans).
  useEffect(() => {
    const styleId = "active-comment-style";
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    if (activeCommentId) {
      // Dim all comment highlights, then brighten the active one
      styleEl.textContent = `
        .comment-highlight { background-color: rgba(255,212,0,0.1) !important; border-bottom-color: rgba(255,180,0,0.15) !important; }
        .comment-highlight[data-comment-id="${activeCommentId}"] { background-color: rgba(251,146,60,0.45) !important; border-bottom: 2px solid rgba(234,88,12,0.8) !important; }
      `;
    } else {
      styleEl.textContent = "";
    }

    return () => {
      if (styleEl) styleEl.textContent = "";
    };
  }, [activeCommentId]);

  // Extract headings and notify parent (rAF-batched for performance)
  useEffect(() => {
    if (!editor || !onHeadingsChange) return;
    let rafId: ReturnType<typeof requestAnimationFrame>;
    const schedule = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const headings: HeadingItem[] = [];
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "heading" && [1, 2, 3].includes(node.attrs.level)) {
            headings.push({ level: node.attrs.level as 1 | 2 | 3, text: node.textContent, pos });
          }
        });
        onHeadingsChange(headings);
      });
    };
    editor.on("transaction", schedule);
    schedule(); // fire once on mount
    return () => {
      cancelAnimationFrame(rafId);
      editor.off("transaction", schedule);
    };
  }, [editor, onHeadingsChange]);

  const saveDocument = useCallback(
    async (content: object) => {
      setSaveStatus("saving");
      try {
        const payload: Record<string, unknown> = {
          content: JSON.stringify(content),
        };
        // Non-owners can only save comment mark changes
        if (!isOwner) {
          payload.commentMarkOnly = true;
        }
        await fetch(`/api/documents/${documentId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setSaveStatus("saved");
      } catch {
        setSaveStatus("unsaved");
      }
    },
    [documentId, isOwner]
  );

  // Poll for document updates (picks up comment marks added by other users)
  useEffect(() => {
    if (!editor) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/documents/${documentId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.content) return;

        const serverContent = JSON.parse(data.content);
        const localContent = editor.getJSON();

        // Only update if server content differs (avoids cursor jumps for owner)
        if (JSON.stringify(serverContent) !== JSON.stringify(localContent)) {
          // For reviewers: always update (they're read-only)
          // For owners: only update if they have no unsaved changes
          if (!isOwner || saveStatus === "saved") {
            const { from } = editor.state.selection;
            editor.commands.setContent(serverContent, { emitUpdate: false });
            // Restore cursor position
            try {
              editor.commands.setTextSelection(
                Math.min(from, editor.state.doc.content.size)
              );
            } catch {
              // ignore if position is invalid
            }
          }
        }
      } catch {
        // ignore fetch errors
      }
    };

    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [editor, documentId, isOwner, saveStatus]);

  // Keyboard shortcut for manual save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (editor && isOwner) {
          saveDocument(editor.getJSON());
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [editor, isOwner, saveDocument]);

  const handleAIEdit = useCallback(() => {
    if (!editor || !onAIEditRequest) return;
    const { from, to } = editor.state.selection;
    const displayText = editor.state.doc.textBetween(from, to, "\n");
    if (!displayText.trim()) return;

    const taggedBlocks = extractTaggedBlocks(editor.state, from, to);
    const taggedText =
      taggedBlocks.length > 0
        ? taggedBlocks.map((b) => b.line).join("\n")
        : `[P] ${displayText}`;

    // Collect ~3 blocks before and after the selection as surrounding context.
    // This tells the AI what heading levels are in use, whether lists continue, etc.
    const beforeBlocks = extractTaggedBlocks(
      editor.state,
      Math.max(0, from - 600),
      from
    ).slice(-3);
    const afterBlocks = extractTaggedBlocks(
      editor.state,
      to,
      Math.min(editor.state.doc.content.size, to + 600)
    ).slice(0, 3);

    const surroundingContext =
      beforeBlocks.length > 0 || afterBlocks.length > 0
        ? `\n## Surrounding Context (for formatting reference only — do NOT reproduce)\n` +
          (beforeBlocks.length > 0
            ? `Before selection:\n${beforeBlocks.map((b) => b.line).join("\n")}\n`
            : "") +
          (afterBlocks.length > 0
            ? `After selection:\n${afterBlocks.map((b) => b.line).join("\n")}`
            : "")
        : "";

    onAIEditRequest(displayText, taggedText, taggedBlocks, from, to, surroundingContext);
  }, [editor, onAIEditRequest]);

  const handleAddComment = useCallback(() => {
    if (!editor || !onAddComment) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ");
    if (!selectedText.trim()) return;

    const commentMarkId = `cm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Don't apply the mark yet — only apply it once the comment is actually posted.
    // This prevents orphan highlights when the user cancels without posting.
    onAddComment(commentMarkId, selectedText, from, to);
  }, [editor, onAddComment]);

  const removeCommentMark = useCallback(
    (commentMarkId: string) => {
      if (!editor) return;
      const wasEditable = editor.isEditable;
      if (!wasEditable) editor.setEditable(true);

      editor.commands.unsetCommentMark(commentMarkId);

      if (!wasEditable) editor.setEditable(false);

      triggerSave();
    },
    [editor]
  );

  const triggerSave = useCallback(() => {
    if (!editor) return;
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      saveDocument(editor.getJSON());
    }, 500);
  }, [editor, saveDocument]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      {isOwner && <EditorToolbar editor={editor} />}

      {/* Status bar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-1.5 text-xs text-gray-500">
        <div className="flex items-center gap-3">
          {isOwner ? (
            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-green-700">
              Owner
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">
              Reviewer
            </span>
          )}
          <span>
            {saveStatus === "saving"
              ? "Saving..."
              : saveStatus === "saved"
                ? "Saved"
                : "Unsaved changes"}
          </span>
        </div>
        {editor && (
          <div className="flex items-center gap-3">
            <span>{editor.storage.characterCount.words()} words</span>
            <span>{editor.storage.characterCount.characters()} chars</span>
          </div>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-8 py-8">
          {editor && (
            <BubbleMenu
              editor={editor}
              shouldShow={({ state }) => {
                const { from, to } = state.selection;
                return from !== to;
              }}
              className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 shadow-lg"
            >
              {isOwner && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      editor.chain().focus().toggleBold().run()
                    }
                    className={`rounded px-1.5 py-0.5 text-sm ${
                      editor.isActive("bold")
                        ? "bg-gray-200 font-bold"
                        : "hover:bg-gray-100"
                    }`}
                  >
                    B
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      editor.chain().focus().toggleItalic().run()
                    }
                    className={`rounded px-1.5 py-0.5 text-sm italic ${
                      editor.isActive("italic")
                        ? "bg-gray-200"
                        : "hover:bg-gray-100"
                    }`}
                  >
                    I
                  </button>
                  <div className="mx-1 h-4 w-px bg-gray-200" />
                  {onAIEditRequest && (
                    <button
                      type="button"
                      onClick={handleAIEdit}
                      className="rounded bg-indigo-50 px-2 py-0.5 text-sm font-medium text-indigo-600 hover:bg-indigo-100"
                    >
                      Edit with AI
                    </button>
                  )}
                </>
              )}
              {/* Comment button — available to everyone */}
              {onAddComment && (
                <>
                  {isOwner && <div className="mx-1 h-4 w-px bg-gray-200" />}
                  <button
                    type="button"
                    onClick={handleAddComment}
                    className="rounded bg-yellow-50 px-2 py-0.5 text-sm font-medium text-yellow-700 hover:bg-yellow-100"
                  >
                    Comment
                  </button>
                </>
              )}
            </BubbleMenu>
          )}
          <EditorContent
            editor={editor}
            className="prose prose-lg max-w-none focus:outline-none [&_.tiptap]:min-h-[60vh] [&_.tiptap]:outline-none [&_.tiptap_p.is-editor-empty:first-child::before]:text-gray-400 [&_.tiptap_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.tiptap_p.is-editor-empty:first-child::before]:float-left [&_.tiptap_p.is-editor-empty:first-child::before]:h-0 [&_.tiptap_p.is-editor-empty:first-child::before]:pointer-events-none"
          />
        </div>
      </div>
    </div>
  );
});

export default Editor;
